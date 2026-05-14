const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ====================================================
// 1. INVENTORY & PRODUCT MANAGEMENT
// ====================================================
app.get('/api/inventory', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/product/:barcode', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products WHERE barcode_id = $1', [req.params.barcode]);
        if (result.rows.length > 0) { res.json(result.rows[0]); } else { res.status(404).json({ error: 'Product not found' }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/product/add', async (req, res) => {
    const { barcode_id, name, category, cost_price, selling_price, stock_qty } = req.body;
    try {
        await pool.query(`
            INSERT INTO products (barcode_id, name, category, cost_price, selling_price, stock_qty)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (barcode_id) DO UPDATE SET 
                name = EXCLUDED.name, cost_price = EXCLUDED.cost_price,
                selling_price = EXCLUDED.selling_price, stock_qty = EXCLUDED.stock_qty
        `, [barcode_id, name, category, cost_price, selling_price, stock_qty]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ====================================================
// 2. SERIALIZED ITEM TRACKING
// ====================================================
app.post('/api/products/serial', async (req, res) => {
    const { barcode_id, serial_number } = req.body;
    try {
        await pool.query('INSERT INTO product_serials (barcode_id, serial_number) VALUES ($1, $2) ON CONFLICT DO NOTHING', [barcode_id, serial_number]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/products/serials/:barcode', async (req, res) => {
    try {
        const result = await pool.query('SELECT serial_number FROM product_serials WHERE barcode_id = $1 AND is_sold = false', [req.params.barcode]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ====================================================
// 3. CHECKOUT & SALES
// ====================================================
app.post('/api/checkout', async (req, res) => {
    const { total_amount, items, customer_id } = req.body;
    try {
        const saleResult = await pool.query('INSERT INTO sales (total_amount, items) VALUES ($1, $2) RETURNING id', [total_amount, JSON.stringify(items)]);

        for (let item of items) {
            await pool.query('UPDATE products SET stock_qty = stock_qty - $1 WHERE barcode_id = $2', [item.qty, item.barcode_id]);
            if (item.serial_numbers && item.serial_numbers.length > 0) {
                for (let serial of item.serial_numbers) {
                    await pool.query('UPDATE product_serials SET is_sold = true, sold_at = CURRENT_TIMESTAMP WHERE serial_number = $1', [serial]);
                }
            }
        }
        if (customer_id) {
            await pool.query('UPDATE customers SET balance = balance + $1 WHERE id = $2', [total_amount, customer_id]);
        }
        res.json({ success: true, sale_id: saleResult.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ====================================================
// 4. KHATA & PAYMENT HISTORY (UPGRADED)
// ====================================================
app.get('/api/customers', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM customers ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/customers', async (req, res) => {
    try {
        const { name, phone } = req.body;
        await pool.query('INSERT INTO customers (name, phone) VALUES ($1, $2)', [name, phone]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// New: Records EXACT date when they pay
app.post('/api/customers/pay', async (req, res) => {
    try {
        const { customer_id, amount } = req.body;
        await pool.query('UPDATE customers SET balance = balance - $1 WHERE id = $2', [amount, customer_id]);
        await pool.query('INSERT INTO customer_payments (customer_id, amount) VALUES ($1, $2)', [customer_id, amount]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Payment History for a specific customer
app.get('/api/customers/:id/history', async (req, res) => {
    try {
        const result = await pool.query('SELECT amount, payment_date FROM customer_payments WHERE customer_id = $1 ORDER BY payment_date DESC', [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ====================================================
// 5. DAILY EXPENSES (NEW)
// ====================================================
app.post('/api/expenses', async (req, res) => {
    try {
        const { description, amount } = req.body;
        await pool.query('INSERT INTO expenses (description, amount) VALUES ($1, $2)', [description, amount]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ====================================================
// 6. MASTER ANALYTICS DASHBOARD (UPGRADED)
// ====================================================
app.get('/api/analytics', async (req, res) => {
    try {
        // Today's Sales
        const salesResult = await pool.query(`SELECT COALESCE(SUM(total_amount), 0) as today_sales, COUNT(id) as total_bills FROM sales WHERE DATE(created_at) = CURRENT_DATE`);
        
        // Today's Expenses
        const expResult = await pool.query(`SELECT COALESCE(SUM(amount), 0) as today_expenses FROM expenses WHERE DATE(created_at) = CURRENT_DATE`);

        // Total Shop Inventory Valuation (Cost Price * Stock Qty)
        const inventoryValResult = await pool.query(`SELECT COALESCE(SUM(cost_price * stock_qty), 0) as total_value FROM products WHERE stock_qty > 0`);

        // Get details of what actually sold today (Recent bills)
        const recentBills = await pool.query(`SELECT id, total_amount, items, created_at FROM sales WHERE DATE(created_at) = CURRENT_DATE ORDER BY created_at DESC`);

        res.json({
            today_sales: parseFloat(salesResult.rows[0].today_sales),
            total_bills: parseInt(salesResult.rows[0].total_bills),
            today_expenses: parseFloat(expResult.rows[0].today_expenses),
            total_inventory_value: parseFloat(inventoryValResult.rows[0].total_value),
            recent_bills: recentBills.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ====================================================
// 7. ACCOUNTANT EXPORT (NEW)
// ====================================================
app.get('/api/export/monthly', async (req, res) => {
    try {
        // Fetch this month's sales
        const sales = await pool.query(`
            SELECT id, total_amount, created_at 
            FROM sales 
            WHERE EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE) 
            ORDER BY created_at DESC
        `);

        // Fetch this month's expenses
        const expenses = await pool.query(`
            SELECT description, amount, created_at 
            FROM expenses 
            WHERE EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE) 
            ORDER BY created_at DESC
        `);

        // Fetch this month's Khata payments received
        const payments = await pool.query(`
            SELECT c.name, cp.amount, cp.payment_date 
            FROM customer_payments cp 
            JOIN customers c ON cp.customer_id = c.id 
            WHERE EXTRACT(MONTH FROM cp.payment_date) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM cp.payment_date) = EXTRACT(YEAR FROM CURRENT_DATE) 
            ORDER BY cp.payment_date DESC
        `);

        res.json({
            sales: sales.rows,
            expenses: expenses.rows,
            payments: payments.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ====================================================
// START SERVER
// ====================================================
app.listen(port, () => { console.log(`Mangal & Sons ERP Server running on port ${port}`); });
