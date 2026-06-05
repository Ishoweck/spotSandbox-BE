"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const DRY_RUN = !process.argv.includes('--commit');
const nameArgIdx = process.argv.indexOf('--name');
const PRODUCT_NAME = nameArgIdx !== -1 ? process.argv[nameArgIdx + 1] : 'practical guide on how to start a bu';
async function main() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/vendorspot';
    await mongoose_1.default.connect(uri);
    console.log(`Connected to MongoDB. Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : '⚠️  COMMIT — data will be permanently deleted'}\n`);
    const db = mongoose_1.default.connection.db;
    // ── 1. Find the product ───────────────────────────────────────────────────
    const product = await db.collection('products').findOne({
        name: { $regex: PRODUCT_NAME, $options: 'i' },
    });
    if (!product) {
        console.log(`❌ No product found matching: "${PRODUCT_NAME}"`);
        console.log('Tip: use --name "exact substring" to narrow the search.');
        await mongoose_1.default.disconnect();
        return;
    }
    const productId = product._id;
    console.log(`✅ Found product:`);
    console.log(`   _id   : ${productId}`);
    console.log(`   name  : ${product.name}`);
    console.log(`   price : ₦${product.price}`);
    console.log(`   type  : ${product.productType || 'physical'}`);
    console.log(`   status: ${product.status}\n`);
    // ── 2. Find orders containing this product ────────────────────────────────
    const orders = await db.collection('orders').find({
        'items.product': productId,
    }).toArray();
    console.log(`📦 Orders containing this product: ${orders.length}`);
    for (const o of orders) {
        console.log(`   #${o.orderNumber}  total=₦${o.total}  status=${o.status}  payment=${o.paymentStatus}  created=${o.createdAt?.toISOString().slice(0, 10)}`);
    }
    const orderIds = orders.map(o => o._id);
    // ── 3. Find wallet transactions tied to these orders ──────────────────────
    const wallets = await db.collection('wallets').find({
        'transactions.relatedOrder': { $in: orderIds },
    }).toArray();
    let totalTxCount = 0;
    for (const w of wallets) {
        const affected = w.transactions.filter(t => t.relatedOrder && orderIds.some(oid => oid.equals(t.relatedOrder)));
        totalTxCount += affected.length;
        if (affected.length > 0) {
            console.log(`\n💳 Wallet ${w._id} (user: ${w.user}) — ${affected.length} transaction(s):`);
            for (const t of affected) {
                console.log(`   ${t.type.toUpperCase().padEnd(6)} ₦${t.amount}  purpose=${t.purpose}  ref=${t.reference}`);
            }
        }
    }
    if (totalTxCount === 0)
        console.log('\n💳 No wallet transactions found for these orders.');
    // ── 4. Find carts still holding this product ──────────────────────────────
    const cartsWithItem = await db.collection('carts').countDocuments({
        'items.product': productId,
    });
    console.log(`\n🛒 Carts still holding this product: ${cartsWithItem}`);
    // ── 5. Affiliate links ────────────────────────────────────────────────────
    const affiliateLinks = await db.collection('affiliatelinks').find({
        product: productId,
    }).toArray();
    console.log(`🔗 Affiliate links for this product: ${affiliateLinks.length}`);
    for (const l of affiliateLinks) {
        console.log(`   code=${l.code}  user=${l.user}  clicks=${l.clicks || 0}`);
    }
    // ── 6. Reviews ────────────────────────────────────────────────────────────
    const reviews = await db.collection('reviews').find({
        product: productId,
    }).toArray();
    console.log(`⭐ Reviews for this product: ${reviews.length}`);
    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────');
    console.log('DELETION SUMMARY:');
    console.log(`  1 product`);
    console.log(`  ${orders.length} order(s)`);
    console.log(`  ${totalTxCount} wallet transaction(s) (pulled from ${wallets.length} wallet(s))`);
    console.log(`  ${cartsWithItem} cart item(s)`);
    console.log(`  ${affiliateLinks.length} affiliate link(s)`);
    console.log(`  ${reviews.length} review(s)`);
    console.log('─────────────────────────────────────────\n');
    if (DRY_RUN) {
        console.log('DRY RUN complete — nothing deleted.');
        console.log('Re-run with --commit to apply.\n');
        await mongoose_1.default.disconnect();
        return;
    }
    // ── COMMIT: delete in dependency order ───────────────────────────────────
    console.log('⚠️  Starting deletion...\n');
    // 6a. Pull wallet transactions for these orders out of each wallet
    if (orderIds.length > 0) {
        const walletResult = await db.collection('wallets').updateMany({ 'transactions.relatedOrder': { $in: orderIds } }, { $pull: { transactions: { relatedOrder: { $in: orderIds } } } });
        console.log(`✅ Removed wallet transactions from ${walletResult.modifiedCount} wallet(s)`);
    }
    // 6b. Delete orders
    if (orderIds.length > 0) {
        const ordersResult = await db.collection('orders').deleteMany({
            _id: { $in: orderIds },
        });
        console.log(`✅ Deleted ${ordersResult.deletedCount} order(s)`);
    }
    // 6c. Pull this product out of any carts
    if (cartsWithItem > 0) {
        const cartResult = await db.collection('carts').updateMany({ 'items.product': productId }, { $pull: { items: { product: productId } } });
        console.log(`✅ Removed product from ${cartResult.modifiedCount} cart(s)`);
    }
    // 6d. Delete affiliate links
    if (affiliateLinks.length > 0) {
        const affResult = await db.collection('affiliatelinks').deleteMany({
            product: productId,
        });
        console.log(`✅ Deleted ${affResult.deletedCount} affiliate link(s)`);
    }
    // 6e. Delete reviews
    if (reviews.length > 0) {
        const revResult = await db.collection('reviews').deleteMany({
            product: productId,
        });
        console.log(`✅ Deleted ${revResult.deletedCount} review(s)`);
    }
    // 6f. Delete the product itself
    await db.collection('products').deleteOne({ _id: productId });
    console.log(`✅ Deleted product "${product.name}"`);
    console.log('\n🎉 All done. Database is clean.');
    await mongoose_1.default.disconnect();
}
main().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
//# sourceMappingURL=delete-product-data.js.map