/**
 * @file Helper for chronology-ordering tests: shared utility for testing
 * that queries return created_at-ordered results when LIMIT is applied,
 * not id-ordered results.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const assert = require("node:assert/strict");

/**
 * Assert that a query with LIMIT returns the created_at-ordered top-N,
 * not the id-ordered top-N.
 *
 * @param {Function} seed - Function that bulk-inserts rows with scrambled
 *                          created_at order (newer timestamps get lower ids)
 * @param {Function} run - Function that executes the query under test with LIMIT
 * @param {Array} expected - Expected result rows in created_at order
 * @param {Number} limit - The LIMIT value used in the query
 */
function assertOrderedByCreatedAt({ seed, run, expected, limit }) {
  // Seed the database with scrambled insertion
  seed();

  // Run the query with LIMIT
  const result = run();

  // Assert the result matches created_at order, not id order
  assert.deepEqual(
    result,
    expected,
    `query returned id-ordered rows instead of created_at-ordered; got ${JSON.stringify(result)}`
  );
}

module.exports = { assertOrderedByCreatedAt };
