"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../config/database");
const types_1 = require("../types");
// Models
const User_1 = __importDefault(require("../models/User"));
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const Product_1 = __importDefault(require("../models/Product"));
const Category_1 = __importDefault(require("../models/Category"));
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function slug(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}
function uniqueSlug(base, suffix) {
    return `${slug(base)}-${suffix}`;
}
function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
// ---------------------------------------------------------------------------
// Vendor data — 20 fully-featured Nigerian vendors across diverse niches
// ---------------------------------------------------------------------------
const VENDORS = [
    {
        firstName: 'Chidinma', lastName: 'Okonkwo',
        email: 'chidinma.okonkwo@vendorspot.ng',
        phone: '08031234501',
        businessName: 'Chidi Fashion Hub',
        businessDescription: 'Premium Ankara and contemporary Nigerian fashion for men and women. We source the finest fabrics from Aba and Lagos markets and craft outfits that celebrate African elegance. Same-day alterations available.',
        businessAddress: { street: '14 Allen Avenue', city: 'Ikeja', state: 'Lagos', country: 'Nigeria' },
        businessPhone: '08031234501',
        businessEmail: 'hello@chidifashionhub.ng',
        businessWebsite: 'https://chidifashionhub.ng',
        socialMedia: { instagram: 'chidifashionhub', facebook: 'ChidiFashionHub', tiktok: 'chidi.fashion' },
        bankName: 'GTBank', accountNumber: '0123456781', accountName: 'CHIDINMA OKONKWO', bankCode: '058',
        averageRating: 4.8, totalReviews: 312, totalSales: 4200000, totalOrders: 890,
        responseRate: 98, responseSpeed: 95, isPremium: true,
        category: 'fashion',
        products: [
            { name: 'Classic Ankara Suit (Men)', price: 28500, compareAtPrice: 35000, qty: 50, description: 'Tailored Ankara suit for the modern Nigerian man. Available in sizes S–4XL. Dry-clean only.', tags: ['ankara', 'men', 'fashion', 'suit'], weight: 1.2, sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'], colors: ['Blue Kente', 'Red Kente', 'Gold Kente'] },
            { name: 'Iro & Buba Luxury Set (Women)', price: 19500, compareAtPrice: 24000, qty: 80, description: 'Elegant hand-stitched Iro and Buba set crafted from high-quality George fabric. Perfect for owambe and formal events.', tags: ['women', 'iro', 'buba', 'george'], sizes: ['S', 'M', 'L', 'XL', '2XL'], colors: ['Ivory', 'Wine', 'Royal Blue'] },
            { name: 'Agbada Three-Piece Set', price: 45000, compareAtPrice: 55000, qty: 30, description: 'Full Agbada set with inner shirt and trousers. Gold and silver embroidery. Ships fully ironed.', tags: ['agbada', 'men', 'luxury', 'embroidery'], weight: 2.0, sizes: ['M', 'L', 'XL', '2XL', '3XL'] },
            { name: 'Casual Ankara Top (Unisex)', price: 7500, qty: 200, description: 'Comfortable everyday Ankara top. Machine washable, pre-shrunk fabric.', tags: ['casual', 'ankara', 'unisex', 'top'], sizes: ['XS', 'S', 'M', 'L', 'XL'], colors: ['Mixed Patterns'] },
            { name: 'Adire Tie-Dye Dress', price: 12500, compareAtPrice: 15000, qty: 60, description: 'Handcrafted adire tie-dye midi dress. Each piece is unique — no two are exactly alike. 100% cotton.', tags: ['adire', 'women', 'dress', 'handmade'], sizes: ['S', 'M', 'L', 'XL'] },
        ],
    },
    {
        firstName: 'Emeka', lastName: 'Nwachukwu',
        email: 'emeka.nwachukwu@vendorspot.ng',
        phone: '08031234502',
        businessName: 'TechGadgets NG',
        businessDescription: 'Authorised reseller of genuine smartphones, laptops, accessories and smart home devices. All products come with manufacturer warranty and our 14-day return guarantee. Serving Nigeria since 2018.',
        businessAddress: { street: '5 Computer Village Road', city: 'Ikeja', state: 'Lagos', country: 'Nigeria' },
        businessPhone: '08031234502',
        businessEmail: 'sales@techgadgetsng.com',
        businessWebsite: 'https://techgadgetsng.com',
        socialMedia: { instagram: 'techgadgetsng', twitter: 'techgadgetsng', facebook: 'TechGadgetsNigeria' },
        bankName: 'Zenith Bank', accountNumber: '0123456782', accountName: 'EMEKA NWACHUKWU', bankCode: '057',
        averageRating: 4.6, totalReviews: 521, totalSales: 18500000, totalOrders: 1240,
        responseRate: 96, responseSpeed: 92, isPremium: true,
        category: 'electronics',
        products: [
            { name: 'Wireless Bluetooth Earbuds Pro', price: 18500, compareAtPrice: 25000, qty: 150, description: 'True wireless stereo earbuds with 30-hour battery life, active noise cancellation, and IPX5 water resistance. Compatible with iOS and Android.', tags: ['earbuds', 'bluetooth', 'wireless', 'audio'], weight: 0.08, keyFeatures: ['ANC', '30h battery', 'IPX5', 'Touch controls'] },
            { name: 'USB-C 65W Fast Charger', price: 5500, compareAtPrice: 7000, qty: 300, description: 'GaN technology 65W charger compatible with laptops, tablets and phones. Charges a MacBook Air in under 2 hours.', tags: ['charger', 'usb-c', 'fast-charge', 'gan'], weight: 0.15 },
            { name: 'Portable Power Bank 20000mAh', price: 14000, compareAtPrice: 18500, qty: 120, description: '20000mAh slim power bank with dual USB-A and USB-C outputs. LED power indicator. Charges 4 phones from flat.', tags: ['powerbank', 'portable', 'charging'], weight: 0.42 },
            { name: 'Smart LED Desk Lamp', price: 9500, compareAtPrice: 13000, qty: 80, description: 'Touch-control desk lamp with 5 brightness levels, warm/cool modes, USB charging port and auto-shutoff timer.', tags: ['lamp', 'desk', 'led', 'smart'], weight: 0.65 },
            { name: 'Mechanical Gaming Keyboard', price: 32000, compareAtPrice: 40000, qty: 45, description: 'Full-size mechanical keyboard with Cherry MX Blue switches, per-key RGB lighting, and detachable USB-C cable. N-key rollover.', tags: ['keyboard', 'gaming', 'mechanical', 'rgb'], weight: 1.1 },
        ],
    },
    {
        firstName: 'Fatima', lastName: 'Abdullahi',
        email: 'fatima.abdullahi@vendorspot.ng',
        phone: '08031234503',
        businessName: 'Fatima\'s Organic Kitchen',
        businessDescription: 'Artisanal Nigerian food products made from organic farm-fresh ingredients. No preservatives, no artificial colours — just wholesome food the way our grandmothers made it. Shipping nationwide with insulated packaging.',
        businessAddress: { street: '22 Sultan Road', city: 'Kaduna', state: 'Kaduna', country: 'Nigeria' },
        businessPhone: '08031234503',
        businessEmail: 'orders@fatimaorganickitchen.ng',
        businessWebsite: 'https://fatimaorganickitchen.ng',
        socialMedia: { instagram: 'fatimaorganickitchen', facebook: 'FatimaOrganicKitchen' },
        bankName: 'First Bank', accountNumber: '0123456783', accountName: 'FATIMA ABDULLAHI', bankCode: '011',
        averageRating: 4.9, totalReviews: 198, totalSales: 2100000, totalOrders: 630,
        responseRate: 99, responseSpeed: 97, isPremium: false,
        category: 'food-beverages',
        products: [
            { name: 'Organic Tuwo Shinkafa Flour (2kg)', price: 4200, qty: 200, description: 'Stone-milled organic tuwo shinkafa flour from Bida farms. No additives. Sealed in food-grade kraft packaging.', tags: ['tuwo', 'flour', 'organic', 'northern'], weight: 2.1 },
            { name: 'Groundnut Oil Cold-Pressed (1 litre)', price: 5500, compareAtPrice: 6500, qty: 150, description: 'Cold-pressed groundnut oil from Kano farms. Rich aroma, high smoke point. Perfect for frying and stewing.', tags: ['groundnut', 'oil', 'organic', 'cooking'], weight: 1.05 },
            { name: 'Zobo Hibiscus Drink Mix (500g)', price: 2800, qty: 300, description: 'Dried hibiscus petals blended with ginger, cloves and pineapple flavour. Just add hot water and strain. Makes 5 litres.', tags: ['zobo', 'hibiscus', 'drink', 'natural'], weight: 0.52 },
            { name: 'Honey Raw Unfiltered (500ml)', price: 6800, compareAtPrice: 8000, qty: 100, description: 'Pure raw honey from Plateau State beekeepers. Unfiltered, unpasteurised. Contains natural pollen and enzymes.', tags: ['honey', 'raw', 'organic', 'plateau'], weight: 0.72 },
            { name: 'Mixed Spice Pack (Suya Pepper Blend)', price: 1500, qty: 500, description: 'Authentic suya pepper blend with kuli-kuli, ginger, garlic and secret spices. 100g resealable pouch.', tags: ['suya', 'spice', 'seasoning', 'blend'], weight: 0.12 },
        ],
    },
    {
        firstName: 'Tunde', lastName: 'Adeyemi',
        email: 'tunde.adeyemi@vendorspot.ng',
        phone: '08031234504',
        businessName: 'NaijaBeauty Pro',
        businessDescription: 'Nigeria\'s premier destination for natural hair care, skincare and beauty products specially formulated for melanin-rich skin and African hair textures. All products are dermatologically tested and free from harmful chemicals.',
        businessAddress: { street: '8 Opebi Road', city: 'Ikeja', state: 'Lagos', country: 'Nigeria' },
        businessPhone: '08031234504',
        businessEmail: 'hello@naijabeautypro.ng',
        businessWebsite: 'https://naijabeautypro.ng',
        socialMedia: { instagram: 'naijabeautypro', tiktok: 'naijabeautypro', facebook: 'NaijaBeautyPro' },
        bankName: 'UBA', accountNumber: '0123456784', accountName: 'TUNDE ADEYEMI', bankCode: '033',
        averageRating: 4.7, totalReviews: 445, totalSales: 5600000, totalOrders: 1560,
        responseRate: 95, responseSpeed: 90, isPremium: true,
        category: 'beauty-health',
        products: [
            { name: 'Shea Butter Body Cream (250ml)', price: 3800, compareAtPrice: 4500, qty: 300, description: 'Rich whipped shea butter cream with vitamin E and argan oil. Deeply moisturises and evens skin tone. Fragrance-free option available.', tags: ['shea', 'body', 'moisturiser', 'natural'], weight: 0.28 },
            { name: 'Black Castor Oil Hair Growth Oil (100ml)', price: 4500, compareAtPrice: 5800, qty: 250, description: 'Jamaican Black Castor Oil enriched with rosemary, peppermint and biotin. Strengthens hair, reduces breakage, promotes growth.', tags: ['castor', 'hair', 'growth', 'natural'], weight: 0.13 },
            { name: 'Kojic Acid & Turmeric Brightening Soap', price: 2200, compareAtPrice: 2800, qty: 400, description: '100g handmade brightening soap with kojic acid, turmeric and papaya extract. Fades dark spots and blemishes in 4–6 weeks.', tags: ['soap', 'brightening', 'kojic', 'turmeric'], weight: 0.11 },
            { name: 'Vitamin C Serum (30ml)', price: 7800, compareAtPrice: 10000, qty: 180, description: '20% Vitamin C serum with hyaluronic acid and niacinamide. Brightens complexion, reduces fine lines, protects against free radicals.', tags: ['serum', 'vitamin-c', 'skincare', 'brightening'], weight: 0.06 },
            { name: 'Natural Lip Gloss Set (6 shades)', price: 5500, compareAtPrice: 7000, qty: 120, description: 'Set of 6 long-lasting lip glosses in warm brown, nude, berry, mauve, coral and deep red. Shea butter-infused for moisture.', tags: ['lip', 'gloss', 'makeup', 'natural'], weight: 0.09 },
        ],
    },
    {
        firstName: 'Ngozi', lastName: 'Eze',
        email: 'ngozi.eze@vendorspot.ng',
        phone: '08031234505',
        businessName: 'HomeStyle NG',
        businessDescription: 'Curated home décor, furniture and lifestyle products blending contemporary design with African aesthetics. From Lagos-made rattan furniture to hand-painted ceramic pieces, we help Nigerians build beautiful homes.',
        businessAddress: { street: '3 Bourdillon Road', city: 'Ikoyi', state: 'Lagos', country: 'Nigeria' },
        businessPhone: '08031234505',
        businessEmail: 'orders@homestyleng.com',
        businessWebsite: 'https://homestyleng.com',
        socialMedia: { instagram: 'homestyleng', pinterest: 'homestyleng', facebook: 'HomeStyleNG' },
        bankName: 'Access Bank', accountNumber: '0123456785', accountName: 'NGOZI EZE', bankCode: '044',
        averageRating: 4.5, totalReviews: 278, totalSales: 8900000, totalOrders: 720,
        responseRate: 93, responseSpeed: 88, isPremium: true,
        category: 'home-living',
        products: [
            { name: 'Rattan Coffee Table (Round)', price: 65000, compareAtPrice: 80000, qty: 20, description: 'Handwoven rattan and tempered glass coffee table. 80cm diameter, natural finish. Assembly required (tools included).', tags: ['rattan', 'furniture', 'coffee-table', 'home'], weight: 8.5 },
            { name: 'Ankara Print Throw Pillow (Set of 4)', price: 12500, compareAtPrice: 16000, qty: 80, description: 'Vibrant Ankara fabric throw pillows with inner cushion included. 45×45cm. Machine washable covers.', tags: ['pillow', 'ankara', 'home', 'decor'], weight: 1.6 },
            { name: 'Hand-Painted Ceramic Vase (Large)', price: 18500, compareAtPrice: 22000, qty: 35, description: 'Large 35cm ceramic vase hand-painted by Lagos artisans with abstract Afrocentric motifs. Each piece is unique.', tags: ['vase', 'ceramic', 'handmade', 'decor'], weight: 1.8 },
            { name: 'Woven Seagrass Storage Basket Set (3)', price: 9800, compareAtPrice: 12500, qty: 60, description: 'Set of 3 nesting seagrass baskets in small, medium and large. Natural finish, ideal for toys, laundry or plants.', tags: ['basket', 'storage', 'seagrass', 'home'], weight: 1.2 },
            { name: 'Scented Soy Candle — Oud & Sandalwood', price: 5500, qty: 150, description: '200g soy wax candle with premium oud and sandalwood fragrance. 45-hour burn time. Handpoured in Lagos.', tags: ['candle', 'soy', 'scented', 'oud'], weight: 0.32 },
        ],
    },
    {
        firstName: 'Bayo', lastName: 'Olatunji',
        email: 'bayo.olatunji@vendorspot.ng',
        phone: '08031234506',
        businessName: 'FitLife Nigeria',
        businessDescription: 'Everything you need for your fitness journey — gym equipment, supplements, sportswear and recovery tools. Trusted by 10,000+ Nigerian athletes and fitness enthusiasts. Free delivery on orders above ₦50,000.',
        businessAddress: { street: '45 Wole Aribiike Street', city: 'Lekki', state: 'Lagos', country: 'Nigeria' },
        businessPhone: '08031234506',
        businessEmail: 'info@fitlifenigeria.ng',
        businessWebsite: 'https://fitlifenigeria.ng',
        socialMedia: { instagram: 'fitlifenigeria', tiktok: 'fitlifeng', twitter: 'FitLifeNG' },
        bankName: 'Stanbic IBTC', accountNumber: '0123456786', accountName: 'BAYO OLATUNJI', bankCode: '221',
        averageRating: 4.6, totalReviews: 389, totalSales: 11200000, totalOrders: 980,
        responseRate: 94, responseSpeed: 89, isPremium: true,
        category: 'sports-fitness',
        products: [
            { name: 'Adjustable Dumbbell Set (5–25kg)', price: 85000, compareAtPrice: 110000, qty: 25, description: 'Quick-change adjustable dumbbells replacing 9 pairs. Dial mechanism selects weight in 2.5kg increments. Comes with stand.', tags: ['dumbbell', 'weights', 'gym', 'fitness'], weight: 35 },
            { name: 'Resistance Band Set (5 levels)', price: 8500, compareAtPrice: 12000, qty: 200, description: 'Latex resistance bands in 5 resistance levels (10–150 lbs). Includes door anchor, handles and ankle straps.', tags: ['resistance', 'bands', 'workout', 'portable'], weight: 0.45 },
            { name: 'Premium Yoga Mat (6mm)', price: 14500, compareAtPrice: 18000, qty: 100, description: 'Non-slip 6mm TPE yoga mat, 183×61cm. Includes carrying strap. Eco-friendly, odour-resistant.', tags: ['yoga', 'mat', 'exercise', 'non-slip'], weight: 1.1 },
            { name: 'Whey Protein Isolate (1kg — Chocolate)', price: 28000, compareAtPrice: 35000, qty: 80, description: '90% protein isolate, <1g fat, <1g carb per 30g serving. 33 servings. Mixes instantly, no chalky aftertaste.', tags: ['protein', 'whey', 'supplement', 'muscle'], weight: 1.05 },
            { name: 'Jump Rope Speed Cable', price: 4200, compareAtPrice: 6000, qty: 300, description: 'Speed jump rope with ball-bearing handles and adjustable steel cable. Used by professional boxers and crossfitters.', tags: ['jump-rope', 'cardio', 'boxing', 'speed'], weight: 0.18 },
        ],
    },
    {
        firstName: 'Aisha', lastName: 'Musa',
        email: 'aisha.musa@vendorspot.ng',
        phone: '08031234507',
        businessName: 'Aisha Craft Studio',
        businessDescription: 'Handmade leather goods, beaded jewellery and African crafts. Every piece is made-to-order in our Abuja studio by skilled artisans. Custom orders accepted — personalised monogramming available on all leather items.',
        businessAddress: { street: '12 Wuse Zone 4', city: 'Abuja', state: 'FCT', country: 'Nigeria' },
        businessPhone: '08031234507',
        businessEmail: 'studio@aishacrafts.ng',
        businessWebsite: 'https://aishacrafts.ng',
        socialMedia: { instagram: 'aishacraftstudio', facebook: 'AishaCraftStudio', tiktok: 'aisha.crafts' },
        bankName: 'Fidelity Bank', accountNumber: '0123456787', accountName: 'AISHA MUSA', bankCode: '070',
        averageRating: 4.9, totalReviews: 156, totalSales: 3400000, totalOrders: 510,
        responseRate: 100, responseSpeed: 98, isPremium: false,
        category: 'arts-crafts',
        products: [
            { name: 'Hand-Stitched Leather Wallet (Men)', price: 12500, compareAtPrice: 16000, qty: 60, description: 'Genuine cowhide bifold wallet with RFID blocking lining. 8 card slots, 2 note compartments. Free monogramming.', tags: ['leather', 'wallet', 'men', 'rfid'], weight: 0.09, colors: ['Tan Brown', 'Midnight Black', 'Chestnut'] },
            { name: 'Beaded Waist Bead Set (3 strands)', price: 5500, qty: 150, description: 'Hand-strung waist beads with semi-precious stone beads in traditional Yoruba, Igbo and Hausa patterns. Adjustable on a cotton thread.', tags: ['waist-beads', 'jewellery', 'african', 'handmade'] },
            { name: 'Leather Crossbody Bag (Women)', price: 28500, compareAtPrice: 36000, qty: 40, description: 'Full-grain leather crossbody bag with adjustable strap, gold-tone hardware and suede lining. Interior zip pocket and card slots.', tags: ['bag', 'leather', 'women', 'crossbody'], weight: 0.62, colors: ['Camel', 'Black', 'Bordeaux'] },
            { name: 'African Print Beaded Necklace', price: 7800, compareAtPrice: 10000, qty: 90, description: 'Statement beaded necklace with Ankara fabric pendant and seed bead chain. Handmade, 50cm length with 5cm extender.', tags: ['necklace', 'beaded', 'african', 'jewellery'] },
            { name: 'Leather Phone Sleeve (Universal)', price: 6500, qty: 80, description: 'Slim vegetable-tanned leather sleeve for phones up to 6.7". Card slot on back. Free monogramming on request.', tags: ['phone', 'leather', 'sleeve', 'accessory'], weight: 0.07 },
        ],
    },
    {
        firstName: 'Chukwuemeka', lastName: 'Obi',
        email: 'chukwuemeka.obi@vendorspot.ng',
        phone: '08031234508',
        businessName: 'BookNest Nigeria',
        businessDescription: 'Nigeria\'s leading online bookstore specialising in African literature, academic textbooks, children\'s books and digital downloads. Over 5,000 titles in stock. Next-day delivery in Lagos, 3–5 days nationwide.',
        businessAddress: { street: '7 University Road', city: 'Enugu', state: 'Enugu', country: 'Nigeria' },
        businessPhone: '08031234508',
        businessEmail: 'orders@booknestnigeria.com',
        businessWebsite: 'https://booknestnigeria.com',
        socialMedia: { instagram: 'booknestnigeria', twitter: 'BookNestNG', facebook: 'BookNestNigeria' },
        bankName: 'Keystone Bank', accountNumber: '0123456788', accountName: 'CHUKWUEMEKA OBI', bankCode: '082',
        averageRating: 4.7, totalReviews: 234, totalSales: 1800000, totalOrders: 870,
        responseRate: 97, responseSpeed: 93, isPremium: false,
        category: 'books-education',
        products: [
            { name: 'Things Fall Apart — Chinua Achebe', price: 3500, qty: 200, description: 'Hardcover edition of the timeless classic. 224 pages. Penguin Modern Classics edition with introduction by Biyi Bandele.', tags: ['novel', 'achebe', 'african', 'literature'], weight: 0.42 },
            { name: 'Purple Hibiscus — Chimamanda Adichie', price: 4200, qty: 180, description: 'Bestselling debut novel by award-winning author Chimamanda Ngozi Adichie. Paperback, 307 pages.', tags: ['novel', 'adichie', 'nigerian', 'fiction'], weight: 0.35 },
            { name: 'WAEC & JAMB Combined Study Guide (Sciences)', price: 8500, compareAtPrice: 10500, qty: 300, description: 'Comprehensive study guide covering Physics, Chemistry, Biology and Mathematics with past questions from 2010–2024.', tags: ['waec', 'jamb', 'study-guide', 'education'], weight: 1.2 },
            { name: 'Eze Goes to School (Children\'s Book)', price: 2200, qty: 250, description: 'Beloved Nigerian children\'s classic. Ages 6–12. Full-colour illustrations, 96 pages. Igbo culture made fun and accessible.', tags: ['children', 'eze', 'classic', 'school'], weight: 0.28 },
            { name: 'Nigerian Business Law Handbook (2024 Ed.)', price: 18500, compareAtPrice: 22000, qty: 80, description: 'Updated 2024 edition covering CAMA 2020, taxation, IP law and employment law. Indispensable for legal practitioners and business owners.', tags: ['law', 'business', 'legal', 'handbook'], weight: 1.5 },
        ],
    },
    {
        firstName: 'Adaeze', lastName: 'Nwosu',
        email: 'adaeze.nwosu@vendorspot.ng',
        phone: '08031234509',
        businessName: 'Little Stars Kids World',
        businessDescription: 'Safe, educational and fun toys and clothing for Nigerian children aged 0–12. All toys are NAFDAC-certified and tested for safety. We stock local and international brands at the best prices in Nigeria.',
        businessAddress: { street: '19 Trans Amadi Road', city: 'Port Harcourt', state: 'Rivers', country: 'Nigeria' },
        businessPhone: '08031234509',
        businessEmail: 'hello@littlestarsnigeria.ng',
        businessWebsite: 'https://littlestarsnigeria.ng',
        socialMedia: { instagram: 'littlestarskidsworld', facebook: 'LittleStarsKidsWorld' },
        bankName: 'FCMB', accountNumber: '0123456789', accountName: 'ADAEZE NWOSU', bankCode: '214',
        averageRating: 4.8, totalReviews: 367, totalSales: 6200000, totalOrders: 1450,
        responseRate: 96, responseSpeed: 91, isPremium: true,
        category: 'kids-babies',
        products: [
            { name: 'Educational Wooden Alphabet Puzzle', price: 4500, compareAtPrice: 6000, qty: 150, description: 'Non-toxic wooden alphabet puzzle with 26 pieces. Bilingual English/Yoruba labels. Ages 2–6. Knob handles for easy grip.', tags: ['puzzle', 'educational', 'wooden', 'alphabet'], weight: 0.55 },
            { name: 'Baby Ankara Onesie Set (0–12 months)', price: 6800, qty: 200, description: 'Set of 3 ankara-print onesies in soft 100% cotton. Snap buttons for easy diaper changes. Pre-washed, gentle on baby skin.', tags: ['baby', 'onesie', 'ankara', 'clothing'], sizes: ['0–3m', '3–6m', '6–9m', '9–12m'] },
            { name: 'Remote Control Car (Junior)', price: 12500, compareAtPrice: 16000, qty: 80, description: 'Full-function 2.4GHz RC car with rechargeable battery, working headlights and 25 km/h top speed. Ages 4+.', tags: ['rc-car', 'toy', 'remote-control', 'boys'], weight: 0.85 },
            { name: 'Colouring Book — African Animals', price: 1800, qty: 500, description: '48 pages of detailed African animal illustrations for colouring. Includes fun facts about each animal. Ages 4–10.', tags: ['colouring', 'book', 'african', 'animals'], weight: 0.22 },
            { name: 'Montessori Stacking Rings Toy', price: 3800, compareAtPrice: 5000, qty: 120, description: 'BPA-free plastic stacking rings in 8 bright colours. Helps develop fine motor skills and colour recognition. Ages 6 months+.', tags: ['montessori', 'stacking', 'baby', 'toy'], weight: 0.38 },
        ],
    },
    {
        firstName: 'Ibrahim', lastName: 'Suleiman',
        email: 'ibrahim.suleiman@vendorspot.ng',
        phone: '08031234510',
        businessName: 'AutoParts Direct NG',
        businessDescription: 'Genuine and OEM-equivalent auto parts and accessories for Nigerian vehicles. Specialists in Toyota, Honda, Nissan, and Peugeot parts. Same-day dispatch from our Abuja and Lagos warehouses. 30-day fitment guarantee.',
        businessAddress: { street: '33 Zaria Road', city: 'Kano', state: 'Kano', country: 'Nigeria' },
        businessPhone: '08031234510',
        businessEmail: 'parts@autopartsdirectng.com',
        businessWebsite: 'https://autopartsdirectng.com',
        socialMedia: { facebook: 'AutoPartsDirectNG', twitter: 'AutoPartsNG' },
        bankName: 'Polaris Bank', accountNumber: '0123456790', accountName: 'IBRAHIM SULEIMAN', bankCode: '076',
        averageRating: 4.4, totalReviews: 189, totalSales: 9800000, totalOrders: 650,
        responseRate: 91, responseSpeed: 85, isPremium: false,
        category: 'automotive',
        products: [
            { name: 'Toyota Camry Brake Pads (Front) 2012–2017', price: 12500, compareAtPrice: 16000, qty: 100, description: 'OEM-equivalent ceramic brake pads for Toyota Camry 2012–2017 models. Comes as a full axle set (4 pads). 50,000km lifespan.', tags: ['brake-pads', 'toyota', 'camry', 'auto-parts'], weight: 1.2 },
            { name: 'Engine Oil Filter — Universal (Set of 3)', price: 4500, qty: 300, description: 'High-efficiency spin-on oil filters compatible with most Japanese and European vehicles. Includes anti-drain back valve.', tags: ['oil-filter', 'engine', 'universal', 'car'], weight: 0.45 },
            { name: 'Honda Accord Headlight Assembly (Left) 2008–2012', price: 35000, compareAtPrice: 45000, qty: 25, description: 'Direct-fit headlight assembly for Honda Accord 2008–2012. Clear lens, includes bulb. Plug-and-play installation.', tags: ['headlight', 'honda', 'accord', 'lighting'], weight: 2.1 },
            { name: 'Car Seat Covers (Universal Fit — Set of 5)', price: 18500, compareAtPrice: 24000, qty: 60, description: 'Waterproof PU leather seat covers for front and rear. Universal fit for saloon cars. Easy install, includes airbag-compatible stitching.', tags: ['seat-covers', 'leather', 'car', 'interior'], weight: 2.8 },
            { name: 'Digital Tyre Inflator (Portable)', price: 15500, compareAtPrice: 20000, qty: 80, description: 'Cordless tyre inflator with digital pressure gauge, LED light and auto-shutoff. 12V car adapter and USB-C charging included.', tags: ['tyre', 'inflator', 'portable', 'digital'], weight: 0.75 },
        ],
    },
    {
        firstName: 'Yetunde', lastName: 'Bakare',
        email: 'yetunde.bakare@vendorspot.ng',
        phone: '08031234511',
        businessName: 'GlowUp Beauty Bar',
        businessDescription: 'Premium makeup, wigs, and professional beauty tools for the modern Nigerian woman. We stock 100% human hair wigs made by our in-house hair artisans, alongside international makeup brands at duty-free prices.',
        businessAddress: { street: '6 Ogbunike Street', city: 'Onitsha', state: 'Anambra', country: 'Nigeria' },
        businessPhone: '08031234511',
        businessEmail: 'hello@glowupbeautybar.ng',
        businessWebsite: 'https://glowupbeautybar.ng',
        socialMedia: { instagram: 'glowupbeautybar', tiktok: 'glowup.beauty', facebook: 'GlowUpBeautyBar' },
        bankName: 'Ecobank', accountNumber: '0123456791', accountName: 'YETUNDE BAKARE', bankCode: '050',
        averageRating: 4.7, totalReviews: 502, totalSales: 14500000, totalOrders: 2100,
        responseRate: 94, responseSpeed: 88, isPremium: true,
        category: 'beauty-health',
        products: [
            { name: '100% Human Hair Lace Front Wig (20 inch)', price: 95000, compareAtPrice: 120000, qty: 30, description: '20-inch straight lace front wig, 180% density, pre-plucked hairline, baby hairs included. 100% virgin human hair. Can be coloured and bleached.', tags: ['wig', 'human-hair', 'lace-front', 'hair'], weight: 0.22, colors: ['Natural Black', '1B Off Black', 'Dark Brown'] },
            { name: 'Foundation & Concealer Duo (Deep Tones)', price: 14500, compareAtPrice: 18000, qty: 120, description: 'Full-coverage liquid foundation SPF 30 + colour-correcting concealer formulated for shades W70–W100. 24-hour wear.', tags: ['foundation', 'concealer', 'makeup', 'dark-skin'], colors: ['W70', 'W80', 'W90', 'W100'] },
            { name: 'Lash & Brow Serum (5ml)', price: 8500, compareAtPrice: 11000, qty: 200, description: 'Peptide-enriched serum that visibly thickens lashes and brows in 4 weeks. Dermatologist tested, fragrance-free.', tags: ['lash', 'brow', 'serum', 'growth'], weight: 0.04 },
            { name: 'Makeup Brush Set (16-piece)', price: 18500, compareAtPrice: 24000, qty: 80, description: '16 professional makeup brushes with synthetic bristles, aluminium ferrules and rose-gold handles. Includes roll-up pouch.', tags: ['makeup', 'brushes', 'professional', 'set'], weight: 0.45 },
            { name: 'Matte Liquid Lipstick (Set of 8)', price: 9500, compareAtPrice: 13000, qty: 150, description: 'Long-wearing, transfer-proof matte liquid lipstick in 8 shades curated for deep skin tones: nude, terracotta, plum, burgundy + more.', tags: ['lipstick', 'matte', 'liquid', 'makeup'] },
        ],
    },
    {
        firstName: 'Oluwaseun', lastName: 'Adebayo',
        email: 'oluwaseun.adebayo@vendorspot.ng',
        phone: '08031234512',
        businessName: 'AgriNaija Direct',
        businessDescription: 'Farm-to-table agricultural products sourced directly from smallholder farmers across Nigeria. Fresh produce, grains, and livestock products delivered to your door. Supporting Nigerian farmers while feeding Nigerian families.',
        businessAddress: { street: '44 Ring Road', city: 'Ibadan', state: 'Oyo', country: 'Nigeria' },
        businessPhone: '08031234512',
        businessEmail: 'fresh@agrinaijadirect.ng',
        businessWebsite: 'https://agrinaijadirect.ng',
        socialMedia: { instagram: 'agrinaijadirect', facebook: 'AgriNaijaFresh', twitter: 'AgriNaijaNG' },
        bankName: 'Heritage Bank', accountNumber: '0123456792', accountName: 'OLUWASEUN ADEBAYO', bankCode: '030',
        averageRating: 4.6, totalReviews: 221, totalSales: 3800000, totalOrders: 920,
        responseRate: 92, responseSpeed: 87, isPremium: false,
        category: 'food-beverages',
        products: [
            { name: 'Premium Ofada Rice (5kg)', price: 8500, compareAtPrice: 10500, qty: 200, description: 'Locally grown Ofada rice from Ogun State farms. Parboiled and stone-sorted. Earthy aroma, naturally short-grain. Vacuum sealed.', tags: ['ofada', 'rice', 'local', 'organic'], weight: 5.1 },
            { name: 'Egusi Melon Seeds (1kg)', price: 4800, qty: 300, description: 'Sun-dried and cleaned egusi melon seeds from Benue State. Ready to grind. No additives or preservatives.', tags: ['egusi', 'melon', 'cooking', 'seeds'], weight: 1.05 },
            { name: 'Ogiri Isi (Fermented Locust Bean) 200g', price: 2500, qty: 200, description: 'Traditionally fermented locust bean (dawadawa) with rich umami flavour. Key ingredient in Igbo and Yoruba soups. Sealed in airtight packaging.', tags: ['ogiri', 'locust-bean', 'condiment', 'traditional'], weight: 0.22 },
            { name: 'Dried Stockfish Assorted (500g)', price: 6500, compareAtPrice: 8000, qty: 100, description: 'Norwegian dried stockfish imported and cleaned locally. Mixed cuts for soup. Rich source of protein.', tags: ['stockfish', 'dried', 'protein', 'soup'], weight: 0.55 },
            { name: 'Crayfish Ground (200g)', price: 3200, qty: 400, description: 'Freshly ground crayfish from Cross River State. Clean, sand-free, and full of flavour. Sealed in airtight pouch.', tags: ['crayfish', 'seasoning', 'soup', 'nigerian'], weight: 0.22 },
        ],
    },
    {
        firstName: 'Kehinde', lastName: 'Afolabi',
        email: 'kehinde.afolabi@vendorspot.ng',
        phone: '08031234513',
        businessName: 'SmartOffice Nigeria',
        businessDescription: 'Office furniture, stationery, printing services and workplace solutions for Nigerian businesses. Trusted by 500+ companies including startups, SMEs and government agencies. Bulk discounts available.',
        businessAddress: { street: '11 Adeola Hopewell', city: 'Victoria Island', state: 'Lagos', country: 'Nigeria' },
        businessPhone: '08031234513',
        businessEmail: 'sales@smartofficeng.com',
        businessWebsite: 'https://smartofficeng.com',
        socialMedia: { facebook: 'SmartOfficeNigeria', linkedin: 'smartofficeng', instagram: 'smartofficeng' },
        bankName: 'Wema Bank', accountNumber: '0123456793', accountName: 'KEHINDE AFOLABI', bankCode: '035',
        averageRating: 4.3, totalReviews: 167, totalSales: 12400000, totalOrders: 540,
        responseRate: 89, responseSpeed: 83, isPremium: false,
        category: 'office-stationery',
        products: [
            { name: 'Ergonomic Mesh Office Chair', price: 58000, compareAtPrice: 75000, qty: 30, description: 'Adjustable lumbar support, breathable mesh back, 360° swivel, height adjustment and armrests. Weight capacity 120kg. BIFMA certified.', tags: ['chair', 'ergonomic', 'office', 'mesh'], weight: 14 },
            { name: 'Standing Desk Converter (60cm)', price: 42000, compareAtPrice: 55000, qty: 20, description: 'Sit-stand desk riser with gas spring lift, dual-monitor support, keyboard tray and cup holder. Fits desks up to 150cm wide.', tags: ['standing-desk', 'ergonomic', 'office', 'monitor'], weight: 11 },
            { name: 'Whiteboard (90×120cm) + Markers Set', price: 18500, compareAtPrice: 24000, qty: 40, description: 'Magnetic dry-erase whiteboard with aluminium frame and integrated marker tray. Includes 8 assorted markers and eraser.', tags: ['whiteboard', 'office', 'marker', 'meeting-room'], weight: 4.5 },
            { name: 'A4 Printing Paper (5 Reams)', price: 16500, compareAtPrice: 19500, qty: 200, description: '80gsm A4 paper, 500 sheets per ream, 5 reams per pack. Suitable for inkjet and laser printers. Acid-free.', tags: ['paper', 'a4', 'printing', 'stationery'], weight: 12.5 },
            { name: 'Business Card Holder (Leather, 3-pack)', price: 7500, qty: 100, description: 'PU leather business card holders in matte black. Each holds 20 cards. Sleek slim design, ideal as corporate gifts.', tags: ['business-card', 'holder', 'leather', 'gift'], weight: 0.18 },
        ],
    },
    {
        firstName: 'Blessing', lastName: 'Okeke',
        email: 'blessing.okeke@vendorspot.ng',
        phone: '08031234514',
        businessName: 'PetPal Nigeria',
        businessDescription: 'Nigeria\'s most-loved pet store for dogs, cats, birds and exotic pets. Premium food, accessories, grooming products and veterinary supplements. Free pet care advice with every order.',
        businessAddress: { street: '25 Agodi Gate Road', city: 'Ibadan', state: 'Oyo', country: 'Nigeria' },
        businessPhone: '08031234514',
        businessEmail: 'care@petpalnigeria.ng',
        businessWebsite: 'https://petpalnigeria.ng',
        socialMedia: { instagram: 'petpalnigeria', facebook: 'PetPalNG', tiktok: 'petpal.ng' },
        bankName: 'SunTrust Bank', accountNumber: '0123456794', accountName: 'BLESSING OKEKE', bankCode: '100',
        averageRating: 4.8, totalReviews: 298, totalSales: 2900000, totalOrders: 780,
        responseRate: 98, responseSpeed: 96, isPremium: false,
        category: 'pets',
        products: [
            { name: 'Premium Dog Food — Chicken & Rice (10kg)', price: 18500, compareAtPrice: 22000, qty: 80, description: 'Complete nutrition for adult dogs. Real chicken as first ingredient, omega-3 for coat health, probiotics for digestion. No fillers.', tags: ['dog-food', 'chicken', 'adult', 'nutrition'], weight: 10.2 },
            { name: 'Cat Scratching Post with Hammock', price: 14500, compareAtPrice: 18000, qty: 50, description: '85cm sisal scratching post with cosy hammock bed. Stable base, easy assembly. Suitable for cats up to 6kg.', tags: ['cat', 'scratching-post', 'hammock', 'pet'], weight: 3.2 },
            { name: 'Dog Harness + Leash Set (Medium)', price: 8500, compareAtPrice: 11000, qty: 100, description: 'No-pull dog harness with reflective strips and padded chest plate. Matching 1.5m leash included. Sizes XS–XL.', tags: ['dog', 'harness', 'leash', 'walking'], sizes: ['XS', 'S', 'M', 'L', 'XL'] },
            { name: 'Pet Grooming Brush (Self-Cleaning)', price: 6500, compareAtPrice: 8500, qty: 120, description: 'Slicker brush with one-click clean button. Works on dogs and cats. Removes loose fur, tangles and dander.', tags: ['grooming', 'brush', 'cat', 'dog'] },
            { name: 'Bird Cage (Large — 60×40×80cm)', price: 32000, compareAtPrice: 40000, qty: 20, description: 'Powder-coated steel bird cage with pull-out tray, 2 perches, 3 feeders and top-opening door. Suits parrots and cockatiels.', tags: ['bird', 'cage', 'parrot', 'pet'], weight: 6.5 },
        ],
    },
    {
        firstName: 'Obinna', lastName: 'Anyanwu',
        email: 'obinna.anyanwu@vendorspot.ng',
        phone: '08031234515',
        businessName: 'SolarPower NG',
        businessDescription: 'Affordable solar energy solutions for homes and businesses in Nigeria. From portable solar lamps to complete 10kVA off-grid systems. NEPZA-registered. Free site assessment within Lagos. Nationwide installation network.',
        businessAddress: { street: '17 Bornu Way', city: 'Apapa', state: 'Lagos', country: 'Nigeria' },
        businessPhone: '08031234515',
        businessEmail: 'info@solarpowerng.com',
        businessWebsite: 'https://solarpowerng.com',
        socialMedia: { facebook: 'SolarPowerNG', instagram: 'solarpowerng', twitter: 'SolarPowerNG' },
        bankName: 'Jaiz Bank', accountNumber: '0123456795', accountName: 'OBINNA ANYANWU', bankCode: '301',
        averageRating: 4.5, totalReviews: 145, totalSales: 22000000, totalOrders: 380,
        responseRate: 93, responseSpeed: 86, isPremium: true,
        category: 'electronics',
        products: [
            { name: '200W Monocrystalline Solar Panel', price: 85000, compareAtPrice: 105000, qty: 40, description: '200W monocrystalline panel, 21% efficiency, 25-year power warranty. Includes mounting brackets and 5m cable kit.', tags: ['solar', 'panel', 'monocrystalline', 'energy'], weight: 13 },
            { name: '150Ah Deep Cycle AGM Battery', price: 145000, compareAtPrice: 170000, qty: 25, description: '150Ah 12V AGM deep cycle battery. 3000+ cycle lifespan at 50% DOD. Maintenance-free, spill-proof.', tags: ['battery', 'agm', 'deep-cycle', 'solar'], weight: 42 },
            { name: 'Solar Lantern with USB Charging (5W)', price: 8500, compareAtPrice: 12000, qty: 200, description: '5W solar lantern with 8-hour run time, built-in 10000mAh battery and 2× USB-A charging ports. Foldable and waterproof.', tags: ['solar', 'lantern', 'portable', 'usb'], weight: 0.38 },
            { name: '3kVA Hybrid Solar Inverter', price: 280000, compareAtPrice: 340000, qty: 15, description: '3000W pure sine wave hybrid inverter with built-in MPPT charge controller (60A). Grid-tie and off-grid compatible.', tags: ['inverter', 'hybrid', 'solar', '3kva'], weight: 18 },
            { name: 'Solar Security Floodlight (50W)', price: 22000, compareAtPrice: 28000, qty: 80, description: 'All-in-one 50W solar floodlight with PIR motion sensor, dawn-to-dusk timer and IP66 waterproofing. No wiring needed.', tags: ['solar', 'floodlight', 'security', 'outdoor'], weight: 3.2 },
        ],
    },
    {
        firstName: 'Hauwa', lastName: 'Garba',
        email: 'hauwa.garba@vendorspot.ng',
        phone: '08031234516',
        businessName: 'Hauwa\'s Confectionery',
        businessDescription: 'Handcrafted cakes, cookies, pastries and catering for events across Northern Nigeria. Specialist in Nigerian wedding cakes, children\'s birthday cakes and corporate gifts. Order 72 hours in advance.',
        businessAddress: { street: '9 Tudun Wada', city: 'Zaria', state: 'Kaduna', country: 'Nigeria' },
        businessPhone: '08031234516',
        businessEmail: 'orders@hauwaconfectionery.ng',
        businessWebsite: 'https://hauwaconfectionery.ng',
        socialMedia: { instagram: 'hauwa_confectionery', facebook: 'HauwaConfectionery', tiktok: 'hauwa.cakes' },
        bankName: 'Unity Bank', accountNumber: '0123456796', accountName: 'HAUWA GARBA', bankCode: '215',
        averageRating: 4.9, totalReviews: 183, totalSales: 1600000, totalOrders: 420,
        responseRate: 99, responseSpeed: 97, isPremium: false,
        category: 'food-beverages',
        products: [
            { name: 'Chin Chin (500g Bag — Assorted)', price: 3500, qty: 300, description: 'Crispy home-fried chin chin in plain, coconut and spiced flavours. Fried fresh and vacuum-sealed. Best seller.', tags: ['chin-chin', 'snack', 'nigerian', 'fried'], weight: 0.52 },
            { name: 'Kuli Kuli Peanut Snack (300g)', price: 2200, qty: 400, description: 'Crunchy Hausa kuli kuli made from roasted groundnuts. High protein snack, no preservatives.', tags: ['kuli-kuli', 'peanut', 'snack', 'hausa'], weight: 0.32 },
            { name: 'Kunun Zaki Mix (1kg)', price: 4500, qty: 150, description: 'Ready-to-cook kunun zaki drink mix with millet, ginger, cloves and tamarind. Just blend with hot water and strain. 8 servings.', tags: ['kunu', 'drink', 'millet', 'traditional'], weight: 1.05 },
            { name: 'Zobo Concentrate Syrup (500ml)', price: 5800, compareAtPrice: 7000, qty: 100, description: 'Concentrated zobo syrup from dried hibiscus, ginger and spices. Mix 1:5 with water. No artificial colours.', tags: ['zobo', 'hibiscus', 'drink', 'concentrate'], weight: 0.62 },
            { name: 'Assorted Shortbread Gift Box (24 pcs)', price: 9500, compareAtPrice: 12000, qty: 60, description: 'Elegant gift box of 24 buttery shortbread cookies in vanilla, almond and cocoa flavours. Ideal for Sallah and corporate gifting.', tags: ['shortbread', 'cookie', 'gift', 'pastry'], weight: 0.55 },
        ],
    },
    {
        firstName: 'Damilare', lastName: 'Akintola',
        email: 'damilare.akintola@vendorspot.ng',
        phone: '08031234517',
        businessName: 'BuildRight Materials',
        businessDescription: 'Quality construction materials, tools and hardware delivered to building sites across Nigeria. Wholesale and retail. Cement, iron rods, tiles, paints, electrical fittings — everything for your construction project.',
        businessAddress: { street: '28 Ojuelegba Road', city: 'Surulere', state: 'Lagos', country: 'Nigeria' },
        businessPhone: '08031234517',
        businessEmail: 'sales@buildrightnigeria.ng',
        businessWebsite: 'https://buildrightnigeria.ng',
        socialMedia: { facebook: 'BuildRightNigeria', instagram: 'buildright.ng' },
        bankName: 'Sterling Bank', accountNumber: '0123456797', accountName: 'DAMILARE AKINTOLA', bankCode: '232',
        averageRating: 4.2, totalReviews: 134, totalSales: 28000000, totalOrders: 460,
        responseRate: 87, responseSpeed: 82, isPremium: false,
        category: 'construction-tools',
        products: [
            { name: 'Dangote Cement (50kg) — Minimum 10 Bags', price: 78000, compareAtPrice: 85000, qty: 500, description: 'Dangote 3X 42.5R cement, 50kg per bag. Price is per 10-bag order. Site delivery within Lagos available.', tags: ['cement', 'dangote', 'construction', 'building'], weight: 500 },
            { name: 'Aluminium Roofing Sheet (Step Tile) per metre', price: 4800, qty: 2000, description: 'Coloured aluminium step-tile roofing sheet, 0.55mm gauge. Anti-rust coating. Cut to length on request.', tags: ['roofing', 'aluminium', 'sheet', 'construction'], weight: 3.5 },
            { name: 'Cordless Drill/Driver (18V)', price: 38000, compareAtPrice: 48000, qty: 50, description: '18V brushless cordless drill with 2×2Ah batteries, fast charger, 13mm keyless chuck and 21+1 torque settings.', tags: ['drill', 'cordless', 'tools', 'electric'], weight: 1.85 },
            { name: 'Wall Paint — Emulsion (20 litres)', price: 28500, compareAtPrice: 35000, qty: 80, description: 'Premium interior emulsion paint. Washable, low-VOC, excellent coverage (12m²/litre). Available in 50 colours.', tags: ['paint', 'emulsion', 'wall', 'interior'], weight: 22 },
            { name: 'Cable Wire (2.5mm Twin & Earth — 100m)', price: 32000, compareAtPrice: 40000, qty: 60, description: '2.5mm twin and earth electrical cable, 100m roll. NERC-approved. Suitable for ring mains and sockets.', tags: ['cable', 'wire', 'electrical', 'wiring'], weight: 8 },
        ],
    },
    {
        firstName: 'Amaka', lastName: 'Okafor',
        email: 'amaka.okafor@vendorspot.ng',
        phone: '08031234518',
        businessName: 'DigitalPrint Studio',
        businessDescription: 'Professional printing, branding and graphic design services. Banners, business cards, branded merch, custom packaging, branded apparel and more. 24-hour turnaround on most products. Trusted by 2,000+ businesses.',
        businessAddress: { street: '4 Ogui Road', city: 'Enugu', state: 'Enugu', country: 'Nigeria' },
        businessPhone: '08031234518',
        businessEmail: 'studio@digitalprintstudio.ng',
        businessWebsite: 'https://digitalprintstudio.ng',
        socialMedia: { instagram: 'digitalprint.ng', facebook: 'DigitalPrintStudioNG' },
        bankName: 'Globus Bank', accountNumber: '0123456798', accountName: 'AMAKA OKAFOR', bankCode: '103',
        averageRating: 4.6, totalReviews: 203, totalSales: 4800000, totalOrders: 860,
        responseRate: 95, responseSpeed: 91, isPremium: false,
        category: 'business-services',
        products: [
            { name: 'Business Cards (500 pcs — Premium Glossy)', price: 8500, compareAtPrice: 12000, qty: 1000, description: '500 full-colour double-sided business cards on 350gsm glossy coated stock. PDF/Ai design files accepted. 48-hour turnaround.', tags: ['business-cards', 'printing', 'branding', 'marketing'], weight: 0.35 },
            { name: 'Roll-up Banner (85×200cm)', price: 18500, compareAtPrice: 24000, qty: 200, description: '85×200cm full-colour roll-up banner with premium aluminium stand and carry bag. Design service available. 24-hour print.', tags: ['banner', 'rollup', 'display', 'event'], weight: 3.2 },
            { name: 'Branded Polo Shirts (Min. 12 pcs)', price: 5500, qty: 500, description: 'Custom embroidered or screen-printed polo shirts per unit (min. 12 pcs). 60% cotton/40% polyester. Sizes XS–3XL.', tags: ['polo', 'branded', 'uniform', 'corporate'], weight: 0.32, sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] },
            { name: 'Custom Packaging Boxes (50 pcs)', price: 22000, compareAtPrice: 28000, qty: 300, description: 'Bespoke printed product boxes with your logo and design. E-flute corrugated board. Min. 50 pcs per order. 5-day lead time.', tags: ['packaging', 'boxes', 'custom', 'branding'], weight: 3 },
            { name: 'Branded Tote Bags (100 pcs)', price: 38000, compareAtPrice: 48000, qty: 100, description: '100 natural cotton tote bags with 1-colour or full-colour screen print. 38×42cm, long handles. Eco-friendly.', tags: ['tote', 'bags', 'branded', 'eco'], weight: 4.5 },
        ],
    },
    {
        firstName: 'Uche', lastName: 'Onyekachi',
        email: 'uche.onyekachi@vendorspot.ng',
        phone: '08031234519',
        businessName: 'NaijaPharm Online',
        businessDescription: 'NAFDAC-licensed online pharmacy offering genuine medications, healthcare products, supplements and medical devices. Prescription verification service available. Discreet packaging, same-day delivery in Abuja.',
        businessAddress: { street: '56 Independence Avenue', city: 'Abuja', state: 'FCT', country: 'Nigeria' },
        businessPhone: '08031234519',
        businessEmail: 'pharmacy@naijapharm.ng',
        businessWebsite: 'https://naijapharm.ng',
        socialMedia: { instagram: 'naijapharm', facebook: 'NaijaPharmOnline', twitter: 'NaijaPharmNG' },
        bankName: 'Providus Bank', accountNumber: '0123456799', accountName: 'UCHE ONYEKACHI', bankCode: '101',
        averageRating: 4.7, totalReviews: 312, totalSales: 7200000, totalOrders: 1320,
        responseRate: 96, responseSpeed: 94, isPremium: true,
        category: 'health-wellness',
        products: [
            { name: 'Vitamin C 1000mg (90 tablets)', price: 5800, compareAtPrice: 7500, qty: 400, description: 'High-strength Vitamin C 1000mg with rosehip and bioflavonoids. 90 tablets. Supports immunity and collagen synthesis. NAFDAC approved.', tags: ['vitamin-c', 'supplement', 'immunity', 'pharmacy'], weight: 0.18 },
            { name: 'Digital Blood Pressure Monitor (Arm)', price: 24500, compareAtPrice: 32000, qty: 80, description: 'Clinically validated automatic upper arm BP monitor. Stores 60 readings, irregular heartbeat detection, large backlit display.', tags: ['blood-pressure', 'monitor', 'health', 'digital'], weight: 0.45 },
            { name: 'Multivitamin & Mineral (Men\'s — 60 tablets)', price: 7500, compareAtPrice: 9500, qty: 300, description: 'Complete daily multivitamin for men with 23 vitamins and minerals including zinc, selenium and B-complex. One-a-day tablet.', tags: ['multivitamin', 'men', 'supplement', 'health'], weight: 0.12 },
            { name: 'Glucometer Starter Kit', price: 18500, compareAtPrice: 24000, qty: 60, description: 'Blood glucose meter with 25 test strips, 25 lancets, lancing device and carry case. 5-second result, no coding required.', tags: ['glucometer', 'diabetes', 'glucose', 'health'], weight: 0.25 },
            { name: 'Hand Sanitiser (500ml Pump) — Pack of 6', price: 9500, compareAtPrice: 12000, qty: 200, description: '70% ethanol WHO-formula hand sanitiser. 500ml pump dispenser, pack of 6. Kills 99.9% of bacteria and viruses.', tags: ['sanitiser', 'hygiene', 'antibacterial', 'health'], weight: 3.5 },
        ],
    },
    {
        firstName: 'Taiwo', lastName: 'Ogundimu',
        email: 'taiwo.ogundimu@vendorspot.ng',
        phone: '08031234520',
        businessName: 'NaijaLearn EdTech',
        businessDescription: 'Digital courses, e-books and online learning resources for Nigerian professionals, students and entrepreneurs. Courses in coding, digital marketing, accounting, agribusiness, and more. Lifetime access, certificate included.',
        businessAddress: { street: '1 Oba Akran Avenue', city: 'Ikeja', state: 'Lagos', country: 'Nigeria' },
        businessPhone: '08031234520',
        businessEmail: 'learn@naijalearnedtech.ng',
        businessWebsite: 'https://naijalearnedtech.ng',
        socialMedia: { instagram: 'naijalearnedtech', facebook: 'NaijaLearnEdTech', twitter: 'NaijaLearnNG', tiktok: 'naija.learn' },
        bankName: 'VFD Microfinance', accountNumber: '0123456800', accountName: 'TAIWO OGUNDIMU', bankCode: '566',
        averageRating: 4.8, totalReviews: 428, totalSales: 9500000, totalOrders: 1890,
        responseRate: 97, responseSpeed: 95, isPremium: true,
        category: 'digital-products',
        products: [
            { name: 'Complete Python for Beginners Course', price: 15000, compareAtPrice: 25000, qty: 9999, description: 'Comprehensive 40-hour Python programming course in Pidgin English. Build 10 real projects including a web scraper and chatbot. Certificate included. Lifetime access.', tags: ['python', 'coding', 'programming', 'beginners'], isDigital: true },
            { name: 'Digital Marketing Masterclass (2024)', price: 18500, compareAtPrice: 30000, qty: 9999, description: 'Facebook Ads, Google Ads, SEO, email marketing and social media strategy — all tailored for the Nigerian market. 35 hours, 8 projects.', tags: ['digital-marketing', 'seo', 'ads', 'course'], isDigital: true },
            { name: 'Accounting & Bookkeeping for SMEs E-Book', price: 5500, compareAtPrice: 8500, qty: 9999, description: '280-page PDF e-book on small business accounting using Zoho Books and Excel. Covers VAT, PAYE and FIRS filings. Practical examples.', tags: ['accounting', 'bookkeeping', 'ebook', 'sme'], isDigital: true },
            { name: 'Agribusiness Startup Guide Bundle', price: 12000, compareAtPrice: 18000, qty: 9999, description: 'E-book + 5-hour video course + Excel financial model templates. Covers poultry, cassava, fish farming and crop production in Nigeria.', tags: ['agribusiness', 'farming', 'startup', 'guide'], isDigital: true },
            { name: 'Professional CV & LinkedIn Makeover Template Pack', price: 3500, compareAtPrice: 6000, qty: 9999, description: '10 ATS-friendly CV templates + LinkedIn profile guide in MS Word and Google Docs formats. Plus a cover letter template. Instant download.', tags: ['cv', 'resume', 'linkedin', 'career'], isDigital: true },
        ],
    },
];
// ---------------------------------------------------------------------------
// Category slug → name lookup (will be fetched from DB)
// ---------------------------------------------------------------------------
const CATEGORY_SLUGS = {
    'fashion': 'Fashion & Clothing',
    'electronics': 'Electronics',
    'food-beverages': 'Food & Beverages',
    'beauty-health': 'Beauty & Health',
    'home-living': 'Home & Living',
    'sports-fitness': 'Sports & Fitness',
    'arts-crafts': 'Arts & Crafts',
    'books-education': 'Books & Education',
    'kids-babies': 'Kids & Babies',
    'automotive': 'Automotive',
    'office-stationery': 'Office & Stationery',
    'pets': 'Pets',
    'construction-tools': 'Construction & Tools',
    'business-services': 'Business Services',
    'health-wellness': 'Health & Wellness',
    'digital-products': 'Digital Products',
};
// ---------------------------------------------------------------------------
// Images — royalty-free Unsplash URLs per category
// ---------------------------------------------------------------------------
const CATEGORY_IMAGES = {
    'fashion': [
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
        'https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=800',
        'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=800',
    ],
    'electronics': [
        'https://images.unsplash.com/photo-1468495244123-6c6c332eeece?w=800',
        'https://images.unsplash.com/photo-1601524909162-ae8725290836?w=800',
        'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800',
    ],
    'food-beverages': [
        'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800',
        'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800',
        'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800',
    ],
    'beauty-health': [
        'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800',
        'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=800',
        'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=800',
    ],
    'home-living': [
        'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800',
        'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=800',
        'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=800',
    ],
    'sports-fitness': [
        'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800',
        'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800',
        'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800',
    ],
    'arts-crafts': [
        'https://images.unsplash.com/photo-1590845947698-8924d7409b56?w=800',
        'https://images.unsplash.com/photo-1606092195730-5d7b9af1efc5?w=800',
        'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=800',
    ],
    'books-education': [
        'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800',
        'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=800',
        'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=800',
    ],
    'kids-babies': [
        'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800',
        'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=800',
        'https://images.unsplash.com/photo-1565702149990-3a89cead7cad?w=800',
    ],
    'automotive': [
        'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=800',
        'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800',
        'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800',
    ],
    'office-stationery': [
        'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800',
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800',
        'https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=800',
    ],
    'pets': [
        'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=800',
        'https://images.unsplash.com/photo-1415369629372-26f2fe60c467?w=800',
        'https://images.unsplash.com/photo-1574158622682-e40e69881006?w=800',
    ],
    'construction-tools': [
        'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800',
        'https://images.unsplash.com/photo-1581244277943-fe4a9c777189?w=800',
        'https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=800',
    ],
    'business-services': [
        'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=800',
        'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800',
        'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=800',
    ],
    'health-wellness': [
        'https://images.unsplash.com/photo-1550831107-1553da8c8464?w=800',
        'https://images.unsplash.com/photo-1505576399279-565b52d4ac71?w=800',
        'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800',
    ],
    'digital-products': [
        'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=800',
        'https://images.unsplash.com/photo-1516321165247-4aa89a48be28?w=800',
        'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800',
    ],
};
// Banner images per vendor category
const BANNER_IMAGES = {
    'fashion': 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200',
    'electronics': 'https://images.unsplash.com/photo-1468495244123-6c6c332eeece?w=1200',
    'food-beverages': 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200',
    'beauty-health': 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1200',
    'home-living': 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200',
    'sports-fitness': 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200',
    'arts-crafts': 'https://images.unsplash.com/photo-1590845947698-8924d7409b56?w=1200',
    'books-education': 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=1200',
    'kids-babies': 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=1200',
    'automotive': 'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=1200',
    'office-stationery': 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200',
    'pets': 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=1200',
    'construction-tools': 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200',
    'business-services': 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=1200',
    'health-wellness': 'https://images.unsplash.com/photo-1550831107-1553da8c8464?w=1200',
    'digital-products': 'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=1200',
};
const LOGO_IMAGES = {
    'fashion': 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400',
    'electronics': 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400',
    'food-beverages': 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=400',
    'beauty-health': 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=400',
    'home-living': 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=400',
    'sports-fitness': 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=400',
    'arts-crafts': 'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=400',
    'books-education': 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=400',
    'kids-babies': 'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=400',
    'automotive': 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400',
    'office-stationery': 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=400',
    'pets': 'https://images.unsplash.com/photo-1415369629372-26f2fe60c467?w=400',
    'construction-tools': 'https://images.unsplash.com/photo-1581244277943-fe4a9c777189?w=400',
    'business-services': 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=400',
    'health-wellness': 'https://images.unsplash.com/photo-1505576399279-565b52d4ac71?w=400',
    'digital-products': 'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=400',
};
// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------
async function seed() {
    await (0, database_1.connectDB)();
    console.log('\n🌱 Starting vendor seed...\n');
    const password = await bcryptjs_1.default.hash('Vendor@123', 10);
    // Fetch or create categories
    const categoryMap = {};
    for (const [catSlug, catName] of Object.entries(CATEGORY_SLUGS)) {
        let cat = await Category_1.default.findOne({ slug: catSlug });
        if (!cat) {
            cat = await Category_1.default.create({ name: catName, slug: catSlug, level: 0, isActive: true, order: 0, productCount: 0 });
            console.log(`  ✅ Created category: ${catName}`);
        }
        categoryMap[catSlug] = cat._id;
    }
    let vendorsCreated = 0;
    let productsCreated = 0;
    let skipped = 0;
    for (const v of VENDORS) {
        // Skip if email already exists
        const existing = await User_1.default.findOne({ email: v.email });
        if (existing) {
            console.log(`  ⏭️  Skipping ${v.businessName} — email already exists`);
            skipped++;
            continue;
        }
        // 1. Create user
        const user = await User_1.default.create({
            firstName: v.firstName,
            lastName: v.lastName,
            email: v.email,
            phone: v.phone,
            password,
            role: types_1.UserRole.VENDOR,
            status: types_1.UserStatus.ACTIVE,
            emailVerified: true,
            phoneVerified: true,
            avatar: LOGO_IMAGES[v.category] || '',
            points: rand(500, 5000),
            badges: ['verified-identity'],
            loginStreak: { currentStreak: rand(1, 30), lastLoginDate: new Date() },
        });
        // 2. Create vendor profile
        await VendorProfile_1.default.create({
            user: user._id,
            businessName: v.businessName,
            businessDescription: v.businessDescription,
            businessLogo: LOGO_IMAGES[v.category] || '',
            businessBanner: BANNER_IMAGES[v.category] || '',
            businessAddress: v.businessAddress,
            businessPhone: v.businessPhone,
            businessEmail: v.businessEmail,
            businessWebsite: v.businessWebsite,
            socialMedia: v.socialMedia,
            verificationStatus: types_1.VendorVerificationStatus.VERIFIED,
            verifiedAt: new Date(Date.now() - rand(30, 365) * 24 * 60 * 60 * 1000),
            kycDocuments: [
                {
                    type: 'CAC',
                    documentUrl: 'https://images.unsplash.com/photo-1568992687947-868a62a9f521?w=800',
                    verificationStatus: 'verified',
                    verifiedAt: new Date(),
                },
                {
                    type: 'NIN',
                    documentUrl: 'https://images.unsplash.com/photo-1568992687947-868a62a9f521?w=800',
                    verificationStatus: 'verified',
                    verifiedAt: new Date(),
                },
            ],
            payoutDetails: {
                bankName: v.bankName,
                accountNumber: v.accountNumber,
                accountName: v.accountName,
                bankCode: v.bankCode,
            },
            commissionRate: 8,
            totalSales: v.totalSales,
            totalOrders: v.totalOrders,
            averageRating: v.averageRating,
            totalReviews: v.totalReviews,
            isPremium: v.isPremium,
            isActive: true,
            responseRate: v.responseRate,
            responseSpeed: v.responseSpeed,
            storefront: {
                theme: 'default',
                bannerImages: [BANNER_IMAGES[v.category] || ''],
                customMessage: `Welcome to ${v.businessName}! We offer the best products at unbeatable prices. Reach us at ${v.businessPhone}.`,
            },
            followers: [],
            referralRewarded: false,
            statsComputedAt: new Date(),
        });
        // 3. Create products
        const catId = categoryMap[v.category];
        const images = CATEGORY_IMAGES[v.category] || ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800'];
        for (const p of v.products) {
            const productSlug = uniqueSlug(p.name, `${Date.now()}-${rand(1000, 9999)}`);
            const isDigital = p.isDigital === true;
            const productData = {
                name: p.name,
                slug: productSlug,
                description: p.description,
                shortDescription: p.description.substring(0, 180),
                vendor: user._id,
                category: catId,
                productType: isDigital ? types_1.ProductType.DIGITAL : types_1.ProductType.PHYSICAL,
                price: p.price,
                ...(p.compareAtPrice && { compareAtPrice: p.compareAtPrice }),
                sku: `VS-${Date.now()}-${rand(10000, 99999)}`,
                quantity: p.qty,
                lowStockThreshold: Math.max(5, Math.floor(p.qty * 0.1)),
                images: images.slice(0, 3),
                tags: p.tags,
                status: types_1.ProductStatus.ACTIVE,
                isFlashSale: false,
                isFeatured: Math.random() > 0.7,
                isAffiliate: Math.random() > 0.6,
                affiliateCommission: rand(5, 15),
                averageRating: Math.max(3.5, v.averageRating - Math.random() * 0.5),
                totalReviews: rand(10, Math.min(100, v.totalReviews)),
                totalSales: rand(50, 500),
                views: rand(200, 5000),
                seo: { keywords: p.tags },
            };
            if (p.weight)
                productData.weight = p.weight;
            if (p.sizes)
                productData.sizes = p.sizes;
            if (p.colors)
                productData.colors = p.colors;
            if (p.keyFeatures)
                productData.keyFeatures = p.keyFeatures;
            if (isDigital) {
                productData.digitalFile = {
                    url: `https://storage.vendorspot.ng/digital/${productSlug}.zip`,
                    fileName: `${slug(p.name)}.zip`,
                    fileSize: rand(5, 500) * 1024 * 1024,
                    fileType: 'application/zip',
                    version: '1.0',
                    uploadedAt: new Date(),
                };
            }
            else {
                productData.dimensions = { length: rand(5, 50), width: rand(5, 40), height: rand(2, 30) };
            }
            await Product_1.default.create(productData);
            productsCreated++;
        }
        // Update category product count
        await Category_1.default.findByIdAndUpdate(catId, { $inc: { productCount: v.products.length } });
        console.log(`  ✅ ${v.businessName} (${v.firstName} ${v.lastName}) — ${v.products.length} products`);
        vendorsCreated++;
    }
    console.log(`\n🎉 Seed complete!`);
    console.log(`   Vendors created : ${vendorsCreated}`);
    console.log(`   Products created: ${productsCreated}`);
    console.log(`   Skipped (exist) : ${skipped}`);
    console.log(`\n   Default password: Vendor@123\n`);
    await mongoose_1.default.disconnect();
    process.exit(0);
}
seed().catch((err) => {
    console.error('❌ Seed failed:', err);
    mongoose_1.default.disconnect().finally(() => process.exit(1));
});
//# sourceMappingURL=seedVendors.js.map