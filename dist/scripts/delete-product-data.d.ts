/**
 * Cleanup: Delete a product and all its related data
 *
 * Removes: product, all orders containing it, associated wallet transactions,
 * cart references, affiliate links, and reviews.
 *
 * Usage:
 *   npx ts-node src/scripts/delete-product-data.ts                         # dry run
 *   npx ts-node src/scripts/delete-product-data.ts --commit                # delete everything
 *   npx ts-node src/scripts/delete-product-data.ts --name "some product"   # override name search
 */
import 'dotenv/config';
//# sourceMappingURL=delete-product-data.d.ts.map