import fs from 'fs';
import { parse } from 'csv-parse';
import { db } from './database.js';
import { extractYearFromFilename } from './ckan-client.js';

/**
 * Parse and import CSV/TSV file into database
 */
export async function importCSVFile(filePath, resource) {
  const filename = resource.name;
  const year = extractYearFromFilename(filename);
  const format = resource.format.toLowerCase();
  
  // Detect delimiter by reading just the first line of the file
  const detectDelimiter = (format) => {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(1024);
      fs.readSync(fd, buffer, 0, 1024, 0);
      fs.closeSync(fd);
      
      const firstLine = buffer.toString('utf-8').split('\n')[0];
      
      // Semicolon is most common in Finnish data
      if (firstLine.includes(';')) {
        return ';';
      }
      // Tab for TSV format
      if (format?.toLowerCase() === 'tsv') {
        return '\t';
      }
      // Default to comma
      return ',';
    } catch (err) {
      // Fallback to format-based detection
      return format?.toLowerCase() === 'tsv' ? '\t' : ',';
    }
  };

  const delimiter = detectDelimiter(format);

  console.log(`\n📊 Importing: ${filename}`);
  console.log(`   Year: ${year}`);
  console.log(`   Format: ${format.toUpperCase()}`);
  console.log(`   Delimiter: ${delimiter === '\t' ? 'TAB' : delimiter === ';' ? 'SEMICOLON' : 'COMMA'}`);

  return new Promise((resolve, reject) => {
    const records = [];
    let headerParsed = false;
    let recordCount = 0;
    let errorCount = 0;

  const parser = fs.createReadStream(filePath).pipe(
    parse({
      delimiter,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
      quote: false  // Disable quote parsing to handle malformed data
    })
  );    parser.on('data', (record) => {
      try {
        // Transform CSV record to database format
        const invoice = {
          lasku_id: record.lasku_id || record.invoice_id || '',
          hankintayksikko: record.hankintayksikko || record.procurement_unit || '',
          hankintayksikko_tunnus: record.hankintayksikko_tunnus || record.procurement_unit_id || null,
          ylaorganisaatio: record.ylaorganisaatio || record.parent_organization || null,
          ylaorganisaatio_tunnus: record.ylaorganisaatio_tunnus || record.parent_organization_id || null,
          toimittaja_y_tunnus: record.toimittaja_y_tunnus || record.supplier_business_id || null,
          toimittaja_nimi: record.toimittaja_nimi || record.supplier_name || null,
          toimittaja_kunta: record.toimittaja_kunta || record.supplier_city || null,
          tili: record.tili || record.account || null,
          hankintakategoria: record.hankintakategoria || record.procurement_category || '',
          tuote_palveluryhma: record.tuote_palveluryhma || record.product_service_group || null,
          tositepvm: record.tositepvm || record.invoice_entry_date || '',
          tiliointisumma: parseFloat(record.tiliointisumma || record.posting_sum || '0'),
          sektori: record.sektori || record.sector || null,
          data_year: year
        };

        // Validate required fields
        if (!invoice.lasku_id || !invoice.hankintayksikko || !invoice.hankintakategoria || !invoice.tositepvm) {
          errorCount++;
          if (errorCount <= 5) {
            console.warn(`   ⚠️  Skipping invalid record (missing required fields):`, invoice);
          }
          return;
        }

        records.push(invoice);
        recordCount++;

        // Batch insert every 1000 records
        if (records.length >= 1000) {
          insertBatch(records.splice(0, 1000));
        }

        // Progress indicator
        if (recordCount % 10000 === 0) {
          console.log(`   ... processed ${recordCount.toLocaleString()} records`);
        }
      } catch (error) {
        errorCount++;
        if (errorCount <= 5) {
          console.error(`   ❌ Error parsing record:`, error.message);
        }
      }
    });

    parser.on('end', () => {
      // Insert remaining records
      if (records.length > 0) {
        insertBatch(records);
      }

      console.log(`✅ Import complete: ${filename}`);
      console.log(`   Records imported: ${recordCount.toLocaleString()}`);
      console.log(`   Errors skipped: ${errorCount.toLocaleString()}`);

      // Update metadata
      updateMetadata(resource, recordCount);

      resolve({ recordCount, errorCount });
    });

    parser.on('error', (error) => {
      console.error(`❌ CSV parsing error:`, error.message);
      reject(error);
    });
  });
}

/**
 * Insert a batch of records into the database
 */
function insertBatch(records) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO procurement_invoices (
      lasku_id, hankintayksikko, hankintayksikko_tunnus,
      ylaorganisaatio, ylaorganisaatio_tunnus,
      toimittaja_y_tunnus, toimittaja_nimi, toimittaja_kunta,
      tili, hankintakategoria, tuote_palveluryhma,
      tositepvm, tiliointisumma, sektori, data_year
    ) VALUES (
      @lasku_id, @hankintayksikko, @hankintayksikko_tunnus,
      @ylaorganisaatio, @ylaorganisaatio_tunnus,
      @toimittaja_y_tunnus, @toimittaja_nimi, @toimittaja_kunta,
      @tili, @hankintakategoria, @tuote_palveluryhma,
      @tositepvm, @tiliointisumma, @sektori, @data_year
    )
  `);

  const insertMany = db.transaction((invoices) => {
    for (const invoice of invoices) {
      insert.run(invoice);
    }
  });

  insertMany(records);
}

/**
 * Update dataset metadata after import
 */
function updateMetadata(resource, recordCount) {
  db.prepare(`
    INSERT OR REPLACE INTO dataset_metadata (
      resource_id, resource_name, resource_url, file_format,
      data_year, last_modified, downloaded_at, records_imported, status
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'completed')
  `).run(
    resource.id,
    resource.name,
    resource.url,
    resource.format,
    extractYearFromFilename(resource.name),
    resource.last_modified,
    recordCount
  );
}

/**
 * Import all downloaded CSV files
 */
export async function importAllFiles(downloadResults) {
  console.log('\n📦 Starting database import...\n');

  const results = [];
  
  for (const download of downloadResults) {
    try {
      const result = await importCSVFile(download.filePath, download.resource);
      results.push({
        filename: download.resource.name,
        success: true,
        ...result
      });
    } catch (error) {
      console.error(`❌ Failed to import ${download.resource.name}:`, error.message);
      results.push({
        filename: download.resource.name,
        success: false,
        error: error.message
      });
    }
  }

  const totalRecords = results.reduce((sum, r) => sum + (r.recordCount || 0), 0);
  const successCount = results.filter(r => r.success).length;

  console.log(`\n✅ Import complete!`);
  console.log(`   Files processed: ${results.length}`);
  console.log(`   Successful: ${successCount}`);
  console.log(`   Total records: ${totalRecords.toLocaleString()}`);

  return results;
}

export default {
  importCSVFile,
  importAllFiles
};
