# Finnish Procurement Data Backend API

Backend service that downloads, processes, and serves Finnish government procurement data from Avoindata.fi (OpenProcurement.fi dataset).

## Features

- ✅ **Automatic Data Download**: Fetches CSV files from Avoindata.fi using CKAN API
- ✅ **Data Processing**: Parses and validates procurement invoice data
- ✅ **SQLite Database**: Stores millions of records with optimized indexes
- ✅ **REST API**: Exposes procurement data with powerful filtering
- ✅ **Scheduled Updates**: Weekly data refresh (configurable)

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` if needed (defaults should work fine).

### 3. Download and Import Data

**Option A: Download Recent Years (Recommended for Development)**
```bash
npm run update-data -- --years=2024,2025
```

**Option B: Download All Years (2016-2025)**
```bash
npm run update-data
```

**Option C: Fresh Start (Clear and Redownload)**
```bash
npm run update-data -- --force --clear
```

This will:
1. Download CSV files from Avoindata.fi (~200-500 MB total)
2. Process and import data into SQLite database
3. Takes 5-15 minutes depending on years selected

### 4. Start the Server

```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

Server runs on **http://localhost:3001**

## API Endpoints

### Health Check
```bash
GET /api/health
```

Returns server status and database statistics.

### Get Procurement Invoices
```bash
GET /api/procurement/invoices?limit=100&offset=0&category=IT
```

**Query Parameters:**
- `limit` (default: 100) - Results per page
- `offset` (default: 0) - Pagination offset
- `supplier` - Filter by supplier name or business ID
- `category` - Filter by procurement category
- `city` - Filter by supplier city
- `minAmount` - Minimum invoice amount
- `maxAmount` - Maximum invoice amount
- `startDate` - Start date (YYYY-MM-DD)
- `endDate` - End date (YYYY-MM-DD)
- `sector` - Filter by sector
- `procurementUnit` - Filter by procurement unit
- `year` - Filter by data year

**Example:**
```bash
curl "http://localhost:3001/api/procurement/invoices?category=IT&minAmount=10000&limit=10"
```

### Get Statistics
```bash
GET /api/procurement/stats?year=2024
```

Returns aggregated statistics including:
- Total value
- Total invoices
- Average invoice
- Unique suppliers
- Top categories
- Top suppliers

### Get Categories
```bash
GET /api/procurement/categories
```

Returns list of all unique procurement categories.

### Get Cities
```bash
GET /api/procurement/cities
```

Returns list of all supplier cities.

### Get Procurement Units
```bash
GET /api/procurement/units
```

Returns list of all procurement units.

## Data Update

### Manual Update
```bash
npm run update-data
```

### Update Specific Years
```bash
npm run update-data -- --years=2024,2025
```

### Force Redownload
```bash
npm run update-data -- --force
```

### Clear and Reimport
```bash
npm run update-data -- --force --clear
```

## Database Schema

### procurement_invoices
- `lasku_id` - Invoice ID (unique)
- `hankintayksikko` - Procurement unit
- `hankintayksikko_tunnus` - Procurement unit ID
- `ylaorganisaatio` - Parent organization
- `ylaorganisaatio_tunnus` - Parent organization ID
- `toimittaja_y_tunnus` - Supplier business ID
- `toimittaja_nimi` - Supplier name
- `toimittaja_kunta` - Supplier city
- `tili` - Account code
- `hankintakategoria` - Procurement category
- `tuote_palveluryhma` - Product/service group
- `tositepvm` - Invoice entry date
- `tiliointisumma` - Posting amount
- `sektori` - Sector
- `data_year` - Data year

## Performance

- **Database Size**: ~500 MB - 2 GB (depends on years imported)
- **Records**: ~500K - 5M invoices (2016-2025)
- **Query Speed**: < 100ms for most queries
- **Indexed Fields**: Date, category, supplier, city, unit, amount

## Architecture

```
┌─────────────────┐
│  Avoindata.fi   │  (Finnish Open Data Portal)
│   CKAN API      │
└────────┬────────┘
         │ CSV Files
         ▼
┌─────────────────┐
│  CKAN Client    │  Download CSV/TSV files
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  CSV Importer   │  Parse and validate data
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SQLite DB      │  Store millions of records
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Express API    │  REST endpoints
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  Frontend App   │  React application
└─────────────────┘
```

## Troubleshooting

### "Database locked" Error
SQLite uses WAL mode which supports concurrent reads. If you get this error:
1. Close all database connections
2. Delete `.db-shm` and `.db-wal` files
3. Restart the server

### Download Fails
- Check internet connection
- Avoindata.fi may be temporarily unavailable
- Try again later or use `--force` to retry

### Import Errors
- CSV format may have changed
- Check logs for specific parsing errors
- Try reimporting: `npm run update-data -- --force --clear`

## Data Source

**Dataset:** Data from the OpenProcurement.fi service  
**URL:** https://www.avoindata.fi/data/en_GB/dataset/tutkihankintoja-data  
**License:** CC BY 4.0  
**Update Frequency:** Weekly (Mondays), Monthly for current year  

## Development

### File Structure
```
backend/
├── src/
│   ├── server.js          # Express server
│   ├── database.js        # Database setup and utilities
│   ├── ckan-client.js     # CKAN API client
│   ├── csv-importer.js    # CSV processing
│   ├── data-updater.js    # Data update workflow
│   └── init-db.js         # Database initialization
├── data/
│   ├── csv/               # Downloaded CSV files
│   └── procurement.db     # SQLite database
├── package.json
├── .env.example
└── README.md
```

### Adding New Endpoints
Edit `src/server.js` and add your route:
```javascript
app.get('/api/my-endpoint', (req, res) => {
  // Your code here
});
```

## License

MIT
