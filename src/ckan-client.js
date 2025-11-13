import fetch from 'node-fetch';
import fs from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CKAN_BASE_URL = process.env.CKAN_BASE_URL || 'https://www.avoindata.fi/data/api/3/action';
const DATASET_ID = process.env.DATASET_ID || 'tutkihankintoja-data';
const DOWNLOAD_DIR = join(__dirname, '../data/csv');

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

/**
 * Fetch dataset metadata from CKAN API
 */
export async function fetchDatasetMetadata() {
  try {
    console.log(`Fetching dataset metadata for: ${DATASET_ID}`);
    
    const response = await fetch(`${CKAN_BASE_URL}/package_show?id=${DATASET_ID}`);
    
    if (!response.ok) {
      throw new Error(`CKAN API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error('CKAN API returned unsuccessful response');
    }

    console.log(`✅ Found dataset: ${data.result.title}`);
    console.log(`   Resources: ${data.result.resources.length}`);
    
    return data.result;
  } catch (error) {
    console.error('❌ Error fetching dataset metadata:', error.message);
    throw error;
  }
}

/**
 * Filter resources to get procurement CSV/TSV files
 */
export function filterProcurementResources(dataset) {
  const resources = dataset.resources.filter(resource => {
    const name = resource.name.toLowerCase();
    const format = resource.format.toLowerCase();
    
    // Filter for th_data_YYYY.csv/tsv files
    const isDataFile = name.startsWith('th_data_') && 
                       (format === 'csv' || format === 'tsv' || name.endsWith('.csv') || name.endsWith('.tsv'));
    
    // Exclude translation files
    const isNotTranslation = !name.includes('kaannokset') && !name.includes('translation');
    
    return isDataFile && isNotTranslation;
  });

  // Sort by year (newest first)
  resources.sort((a, b) => {
    const yearA = extractYearFromFilename(a.name);
    const yearB = extractYearFromFilename(b.name);
    return yearB - yearA;
  });

  console.log(`📊 Found ${resources.length} procurement data files`);
  resources.forEach(r => {
    const year = extractYearFromFilename(r.name);
    console.log(`   - ${r.name} (${year}, ${r.format.toUpperCase()})`);
  });

  return resources;
}

/**
 * Extract year from filename (e.g., "th_data_2024.csv" -> 2024)
 */
export function extractYearFromFilename(filename) {
  const match = filename.match(/(\d{4})/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Download a CSV/TSV file from URL
 */
export async function downloadFile(resource) {
  const filename = resource.name;
  const url = resource.url;
  const filePath = join(DOWNLOAD_DIR, filename);

  try {
    console.log(`📥 Downloading: ${filename}`);
    console.log(`   URL: ${url}`);

    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    // Stream the file to disk
    await pipeline(response.body, createWriteStream(filePath));

    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log(`✅ Downloaded: ${filename} (${sizeMB} MB)`);

    return {
      filePath,
      size: stats.size,
      resource
    };
  } catch (error) {
    console.error(`❌ Error downloading ${filename}:`, error.message);
    throw error;
  }
}

/**
 * Download all procurement CSV files
 */
export async function downloadAllProcurementFiles(options = {}) {
  const { yearsToDownload = null, forceRedownload = false } = options;

  try {
    const dataset = await fetchDatasetMetadata();
    const resources = filterProcurementResources(dataset);

    let resourcesToDownload = resources;

    // Filter by years if specified
    if (yearsToDownload && yearsToDownload.length > 0) {
      resourcesToDownload = resources.filter(r => {
        const year = extractYearFromFilename(r.name);
        return yearsToDownload.includes(year);
      });
      console.log(`🎯 Filtering to years: ${yearsToDownload.join(', ')}`);
    }

    const downloadResults = [];

    for (const resource of resourcesToDownload) {
      const filename = resource.name;
      const filePath = join(DOWNLOAD_DIR, filename);

      // Skip if file exists and not forcing redownload
      if (fs.existsSync(filePath) && !forceRedownload) {
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`⏭️  Skipping (already exists): ${filename} (${sizeMB} MB)`);
        downloadResults.push({
          filePath,
          size: stats.size,
          resource,
          skipped: true
        });
        continue;
      }

      const result = await downloadFile(resource);
      downloadResults.push({
        ...result,
        skipped: false
      });
    }

    console.log(`\n✅ Download complete: ${downloadResults.length} files`);
    console.log(`   Downloaded: ${downloadResults.filter(r => !r.skipped).length}`);
    console.log(`   Skipped: ${downloadResults.filter(r => r.skipped).length}`);

    return downloadResults;
  } catch (error) {
    console.error('❌ Error downloading files:', error.message);
    throw error;
  }
}

export default {
  fetchDatasetMetadata,
  filterProcurementResources,
  downloadFile,
  downloadAllProcurementFiles,
  extractYearFromFilename
};
