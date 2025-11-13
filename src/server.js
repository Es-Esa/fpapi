import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { db, initializeDatabase, getDatabaseStats } from './database.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS Configuration - Add your production domains here
const allowedOrigins = [
  'http://localhost:5173',      // Local development
  'http://localhost:3000',      // Alternative local port
  'http://localhost:4173',      // Vite preview
  process.env.FRONTEND_URL,     // Production frontend URL from environment
  // Add your Vercel domain when deployed, e.g.:
  // 'https://paymentfinder.vercel.app',
  // 'https://your-custom-domain.com'
];

// Middleware
app.use(helmet());
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes(undefined)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, true); // Allow all origins in development, restrict in production
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(compression());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Initialize database
initializeDatabase();

// ==================== API ROUTES ====================

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  try {
    const stats = getDatabaseStats();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        ...stats
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

/**
 * GET /api/procurement/invoices
 * Get procurement invoices with filtering
 */
app.get('/api/procurement/invoices', (req, res) => {
  try {
    const {
      limit = 100,
      offset = 0,
      supplier,
      category,
      city,
      minAmount,
      maxAmount,
      startDate,
      endDate,
      sector,
      procurementUnit,
      year
    } = req.query;

    // Build WHERE clause dynamically
    const conditions = [];
    const params = {};

    if (supplier) {
      conditions.push('(toimittaja_nimi LIKE @supplier OR toimittaja_y_tunnus LIKE @supplier)');
      params.supplier = `%${supplier}%`;
    }

    if (category) {
      conditions.push('hankintakategoria LIKE @category');
      params.category = `%${category}%`;
    }

    if (city) {
      conditions.push('toimittaja_kunta LIKE @city');
      params.city = `%${city}%`;
    }

    if (minAmount) {
      conditions.push('tiliointisumma >= @minAmount');
      params.minAmount = parseFloat(minAmount);
    }

    if (maxAmount) {
      conditions.push('tiliointisumma <= @maxAmount');
      params.maxAmount = parseFloat(maxAmount);
    }

    if (startDate) {
      conditions.push('tositepvm >= @startDate');
      params.startDate = startDate;
    }

    if (endDate) {
      conditions.push('tositepvm <= @endDate');
      params.endDate = endDate;
    }

    if (sector) {
      conditions.push('sektori = @sector');
      params.sector = sector;
    }

    if (procurementUnit) {
      conditions.push('hankintayksikko LIKE @procurementUnit');
      params.procurementUnit = `%${procurementUnit}%`;
    }

    if (year) {
      conditions.push('data_year = @year');
      params.year = parseInt(year);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM procurement_invoices ${whereClause}`;
    const countStmt = db.prepare(countQuery);
    const { total } = countStmt.get(params);

    // Get paginated results
    const dataQuery = `
      SELECT 
        lasku_id, hankintayksikko, hankintayksikko_tunnus,
        ylaorganisaatio, ylaorganisaatio_tunnus,
        toimittaja_y_tunnus, toimittaja_nimi, toimittaja_kunta,
        tili, hankintakategoria, tuote_palveluryhma,
        tositepvm, tiliointisumma, sektori
      FROM procurement_invoices
      ${whereClause}
      ORDER BY tositepvm DESC
      LIMIT @limit OFFSET @offset
    `;

    const dataStmt = db.prepare(dataQuery);
    const invoices = dataStmt.all({
      ...params,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: invoices,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: (parseInt(offset) + parseInt(limit)) < total
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/procurement/stats
 * Get procurement statistics
 */
app.get('/api/procurement/stats', (req, res) => {
  try {
    const { year } = req.query;

    const yearCondition = year ? 'WHERE data_year = ?' : '';
    const yearParam = year ? [parseInt(year)] : [];

    const stats = {
      totalValue: db.prepare(`
        SELECT COALESCE(SUM(tiliointisumma), 0) as value
        FROM procurement_invoices
        ${yearCondition}
      `).get(yearParam).value,

      totalInvoices: db.prepare(`
        SELECT COUNT(*) as count
        FROM procurement_invoices
        ${yearCondition}
      `).get(yearParam).count,

      averageInvoice: db.prepare(`
        SELECT COALESCE(AVG(tiliointisumma), 0) as avg
        FROM procurement_invoices
        ${yearCondition}
      `).get(yearParam).avg,

      uniqueSuppliers: db.prepare(`
        SELECT COUNT(DISTINCT toimittaja_nimi) as count
        FROM procurement_invoices
        WHERE toimittaja_nimi IS NOT NULL
        ${yearCondition ? 'AND data_year = ?' : ''}
      `).get(yearParam).count,

      topCategories: db.prepare(`
        SELECT 
          hankintakategoria as category,
          COUNT(*) as count,
          SUM(tiliointisumma) as total_value
        FROM procurement_invoices
        ${yearCondition}
        GROUP BY hankintakategoria
        ORDER BY total_value DESC
        LIMIT 10
      `).all(yearParam),

      topSuppliers: db.prepare(`
        SELECT 
          toimittaja_nimi as supplier,
          toimittaja_y_tunnus as business_id,
          COUNT(*) as invoice_count,
          SUM(tiliointisumma) as total_value
        FROM procurement_invoices
        WHERE toimittaja_nimi IS NOT NULL
        ${yearCondition ? 'AND data_year = ?' : ''}
        GROUP BY toimittaja_nimi, toimittaja_y_tunnus
        ORDER BY total_value DESC
        LIMIT 10
      `).all(yearParam)
    };

    res.json({
      success: true,
      data: stats,
      year: year ? parseInt(year) : 'all',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/procurement/categories
 * Get unique procurement categories
 */
app.get('/api/procurement/categories', (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT DISTINCT hankintakategoria as category
      FROM procurement_invoices
      WHERE hankintakategoria IS NOT NULL
      ORDER BY hankintakategoria
    `).all();

    res.json({
      success: true,
      data: categories.map(c => c.category),
      count: categories.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/procurement/cities
 * Get unique supplier cities
 */
app.get('/api/procurement/cities', (req, res) => {
  try {
    const cities = db.prepare(`
      SELECT DISTINCT toimittaja_kunta as city
      FROM procurement_invoices
      WHERE toimittaja_kunta IS NOT NULL
      ORDER BY toimittaja_kunta
    `).all();

    res.json({
      success: true,
      data: cities.map(c => c.city),
      count: cities.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/procurement/units
 * Get unique procurement units
 */
app.get('/api/procurement/units', (req, res) => {
  try {
    const units = db.prepare(`
      SELECT DISTINCT hankintayksikko as unit
      FROM procurement_invoices
      WHERE hankintayksikko IS NOT NULL
      ORDER BY hankintayksikko
    `).all();

    res.json({
      success: true,
      data: units.map(u => u.unit),
      count: units.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    path: req.path
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n🚀 Procurement Data API Server');
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   API: http://localhost:${PORT}/api/procurement/invoices`);
  console.log('\n');
  
  // Log database stats
  try {
    const stats = getDatabaseStats();
    console.log('📊 Database Status:');
    console.log(`   Total invoices: ${stats.totalInvoices.toLocaleString()}`);
    console.log(`   Last update: ${stats.lastUpdate || 'Never'}`);
    console.log(`   Dataset files: ${stats.datasetFiles}`);
    if (stats.yearBreakdown.length > 0) {
      console.log('\n   Year breakdown:');
      stats.yearBreakdown.forEach(y => {
        console.log(`   - ${y.data_year}: ${y.count.toLocaleString()} invoices (€${(y.total_value / 1000000).toFixed(2)}M)`);
      });
    }
    console.log('\n');
  } catch (error) {
    console.error('Error getting database stats:', error.message);
  }
});

export default app;
