import dotenv from 'dotenv';
import { initializeDatabase, clearInvoiceData, getDatabaseStats } from './database.js';
import { downloadAllProcurementFiles } from './ckan-client.js';
import { importAllFiles } from './csv-importer.js';

dotenv.config();

/**
 * Main data update workflow
 */
async function updateProcurementData(options = {}) {
  const { 
    years = null, // null = all years, or array like [2023, 2024, 2025]
    forceRedownload = false,
    clearExisting = false
  } = options;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   Finnish Procurement Data Updater (Avoindata.fi)        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Initialize database
    console.log('📦 Step 1: Initialize Database\n');
    initializeDatabase();

    // Step 2: Clear existing data if requested
    if (clearExisting) {
      console.log('\n🗑️  Step 2: Clear Existing Data\n');
      clearInvoiceData();
    }

    // Step 3: Download CSV files from Avoindata.fi
    console.log('\n📥 Step 3: Download CSV Files from Avoindata.fi\n');
    const downloadResults = await downloadAllProcurementFiles({
      yearsToDownload: years,
      forceRedownload
    });

    if (downloadResults.length === 0) {
      console.log('\n⚠️  No files to process. Exiting.');
      return;
    }

    // Step 4: Import CSV files into database
    console.log('\n💾 Step 4: Import Data into Database\n');
    const importResults = await importAllFiles(downloadResults);

    // Step 5: Show final statistics
    console.log('\n📊 Step 5: Final Statistics\n');
    const stats = getDatabaseStats();
    
    console.log('✅ Data update complete!\n');
    console.log('Database Summary:');
    console.log(`  Total invoices: ${stats.totalInvoices.toLocaleString()}`);
    console.log(`  Dataset files: ${stats.datasetFiles}`);
    console.log(`  Last update: ${stats.lastUpdate || 'Just now'}`);
    
    if (stats.yearBreakdown.length > 0) {
      console.log('\nYear Breakdown:');
      stats.yearBreakdown.forEach(y => {
        const avgInvoice = y.count > 0 ? (y.total_value / y.count) : 0;
        console.log(`  ${y.data_year}:`);
        console.log(`    Invoices: ${y.count.toLocaleString()}`);
        console.log(`    Total Value: €${(y.total_value / 1000000).toFixed(2)}M`);
        console.log(`    Average: €${avgInvoice.toFixed(2)}`);
      });
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   ✅ All operations completed successfully!              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ Error during data update:');
    console.error(error);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  years: null,
  forceRedownload: args.includes('--force'),
  clearExisting: args.includes('--clear')
};

// Check for specific years
const yearArg = args.find(arg => arg.startsWith('--years='));
if (yearArg) {
  options.years = yearArg.split('=')[1].split(',').map(y => parseInt(y.trim()));
}

// Show help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Finnish Procurement Data Updater

Usage:
  npm run update-data [options]

Options:
  --years=2023,2024,2025    Download specific years only
  --force                   Force re-download even if files exist
  --clear                   Clear all existing data before import
  --help, -h                Show this help message

Examples:
  npm run update-data                      # Download and import all years
  npm run update-data -- --years=2024,2025 # Only 2024 and 2025
  npm run update-data -- --force --clear   # Fresh start, redownload everything
  `);
  process.exit(0);
}

// Run the update
updateProcurementData(options);
