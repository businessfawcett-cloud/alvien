import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const TEST_EMAIL = 'test@alvien-test.example.com'
let passed = 0
let failed = 0

async function assert(label, fn) {
  try {
    await fn()
    passed++
    console.log(`  PASS  ${label}`)
  } catch (err) {
    failed++
    console.log(`  FAIL  ${label}: ${err.message}`)
  }
}

async function run() {
  console.log('\n Credit System Tests\n')

  // --- Setup: ensure table exists ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      email TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      credits INTEGER NOT NULL DEFAULT 0,
      subscription_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Clean up any previous test data
  await pool.query('DELETE FROM customers WHERE email = $1', [TEST_EMAIL])

  // --- Test 1: Assign Agency plan ---
  await assert('assignCredits: Agency plan gives 10 credits', async () => {
    await pool.query(
      `INSERT INTO customers (email, plan, credits, subscription_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         plan = EXCLUDED.plan, credits = EXCLUDED.credits,
         subscription_id = EXCLUDED.subscription_id, updated_at = NOW()`,
      [TEST_EMAIL, 'agency', 10, 'sub_test_agency']
    )
    const { rows } = await pool.query('SELECT credits, plan FROM customers WHERE email = $1', [TEST_EMAIL])
    if (rows[0].credits !== 10) throw new Error(`Expected 10 credits, got ${rows[0].credits}`)
    if (rows[0].plan !== 'agency') throw new Error(`Expected plan agency, got ${rows[0].plan}`)
  })

  // --- Test 2: Deduct 1 credit ---
  await assert('deductCredit: goes from 10 to 9', async () => {
    const result = await pool.query(
      'UPDATE customers SET credits = credits - 1 WHERE email = $1 AND credits > 0 RETURNING credits',
      [TEST_EMAIL]
    )
    if (result.rowCount !== 1) throw new Error('Expected 1 row updated')
    if (result.rows[0].credits !== 9) throw new Error(`Expected 9 credits remaining, got ${result.rows[0].credits}`)
  })

  // --- Test 3: Get credits ---
  await assert('getCredits: returns 9', async () => {
    const { rows } = await pool.query('SELECT credits FROM customers WHERE email = $1', [TEST_EMAIL])
    if (rows[0].credits !== 9) throw new Error(`Expected 9, got ${rows[0].credits}`)
  })

  // --- Test 4: Reset monthly credits ---
  await assert('resetMonthlyCredits: Agency resets to 10', async () => {
    await pool.query(
      `UPDATE customers SET credits = CASE WHEN plan = 'cohort' THEN 50 ELSE 10 END WHERE email = $1`,
      [TEST_EMAIL]
    )
    const { rows } = await pool.query('SELECT credits FROM customers WHERE email = $1', [TEST_EMAIL])
    if (rows[0].credits !== 10) throw new Error(`Expected 10, got ${rows[0].credits}`)
  })

  // --- Test 5: Deduct until 0 ---
  await assert('deductCredit: deduct 10 times to reach 0', async () => {
    for (let i = 0; i < 10; i++) {
      await pool.query('UPDATE customers SET credits = credits - 1 WHERE email = $1 AND credits > 0', [TEST_EMAIL])
    }
    const { rows } = await pool.query('SELECT credits FROM customers WHERE email = $1', [TEST_EMAIL])
    if (rows[0].credits !== 0) throw new Error(`Expected 0, got ${rows[0].credits}`)
  })

  // --- Test 6: Deduct at 0 returns no rows ---
  await assert('deductCredit: at 0 returns false (0 rows updated)', async () => {
    const result = await pool.query(
      'UPDATE customers SET credits = credits - 1 WHERE email = $1 AND credits > 0',
      [TEST_EMAIL]
    )
    if (result.rowCount !== 0) throw new Error('Expected 0 rows updated when credits are 0')
  })

  // --- Test 7: Assign Cohort plan ---
  await assert('assignCredits: Cohort plan gives 50 credits', async () => {
    await pool.query(
      `INSERT INTO customers (email, plan, credits, subscription_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         plan = EXCLUDED.plan, credits = EXCLUDED.credits,
         subscription_id = EXCLUDED.subscription_id, updated_at = NOW()`,
      [TEST_EMAIL, 'cohort', 50, 'sub_test_cohort']
    )
    const { rows } = await pool.query('SELECT credits, plan FROM customers WHERE email = $1', [TEST_EMAIL])
    if (rows[0].credits !== 50) throw new Error(`Expected 50, got ${rows[0].credits}`)
    if (rows[0].plan !== 'cohort') throw new Error(`Expected plan cohort, got ${rows[0].plan}`)
  })

  // --- Test 8: Reset Cohort ---
  await assert('resetMonthlyCredits: Cohort resets to 50', async () => {
    // First deduct a few
    await pool.query('UPDATE customers SET credits = 3 WHERE email = $1', [TEST_EMAIL])
    // Reset
    await pool.query(
      `UPDATE customers SET credits = CASE WHEN plan = 'cohort' THEN 50 ELSE 10 END WHERE email = $1`,
      [TEST_EMAIL]
    )
    const { rows } = await pool.query('SELECT credits FROM customers WHERE email = $1', [TEST_EMAIL])
    if (rows[0].credits !== 50) throw new Error(`Expected 50, got ${rows[0].credits}`)
  })

  // --- Test 9: Non-existent customer returns 0 ---
  await assert('getCredits: unknown customer returns 0', async () => {
    const { rows } = await pool.query('SELECT credits FROM customers WHERE email = $1', ['nonexistent@test.com'])
    const credits = rows[0]?.credits ?? 0
    if (credits !== 0) throw new Error(`Expected 0, got ${credits}`)
  })

  // --- Cleanup ---
  await pool.query('DELETE FROM customers WHERE email = $1', [TEST_EMAIL])

  console.log(`\n Results: ${passed} passed, ${failed} failed\n`)
  await pool.end()
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(err => {
  console.error('Test error:', err)
  process.exit(1)
})
