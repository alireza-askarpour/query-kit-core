export const sampleQueries = [
  // ============ BASIC OPERATORS ============
  'product.status:eq:active',
  'product.status:neq:discontinued',
  'product.isFeatured:eq:true',
  'product.isArchived:eq:false',

  // Comparison
  'product.rating:gt:4',
  'product.price:gte:100',
  'product.stock:lt:50',
  'product.discount:lte:25',

  // Range
  'product.price:between:50,150',
  'product.weight:between:1,10',
  'product.createdAt:between:2024-01-01,2024-12-31',

  // ============ STRING OPERATORS ============
  'product.name:like:%shoe%',
  'product.slug:iLike:%running%',
  'product.description:contains:waterproof',
  'product.sku:startsWith:SKU-',
  'product.image:endsWith:.jpg',
  'product.title:notLike:%old%',

  // Regex
  'product.sku:regex:^SKU-[0-9]{4}$',
  'product.supportEmail:regex:^[a-z]+@[a-z]+\\.[a-z]{2,}$',

  // ============ ARRAY OPERATORS ============
  'product.tags:in:sale,new,featured',
  'product.tags:notIn:archived,hidden',
  'product.categories:any:electronics,accessories',
  'product.attributes:all:waterproof,lightweight',
  'product.images:size:3',
  'product.variants:size:0',

  // ============ NULL & BOOLEAN ============
  'product.deletedAt:isNull:true',
  'product.publishedAt:isNotNull:true',
  'product.isActive:eq:true',
  'product.isPremium:neq:false',
  'product.category:exists:true',
  'product.supplier:notExists:true',

  // ============ DATE & TIME ============
  'product.createdAt:eq:2024-01-15',
  'product.launchDate:date:2024-05-20',
  'product.createdAt:year:2024',
  'product.createdAt:month:2024-05',
  'product.createdAt:day:15',
  'product.updatedAt:gt:2024-01-01',
  'product.expiryDate:lt:2024-12-31',
  'product.promoEndsAt:between:2024-06-01,2024-08-31',

  // ============ NESTED FIELDS (DOT NOTATION) ============
  'product.category.name:eq:electronics',
  'product.brand.name:eq:nike',
  'product.supplier.address.city:eq:Tehran',
  'product.category.parent.name:eq:footwear',
  'product.reviews.rating:gte:4',
  'product.inventory.warehouse.code:eq:W-01',

  // ============ RELATIONSHIP EXISTENCE ============
  'category:exists:true',
  'brand:exists:true',
  'reviews:exists:true',
  'variants:notExists:true',
  'supplier.profile:exists:true',

  // ============ COMBINED CONDITIONS (AND) ============
  'product.status:eq:active;product.stock:gte:10',
  'product.price:between:100,500;product.inStock:eq:true',
  'product.isFeatured:eq:true;product.rating:gte:4;product.createdAt:year:2024',
  'product.name:like:%running%;product.brand.name:eq:nike;product.isActive:eq:true',
  'product.price:gte:50;product.status:eq:active;product.tags:any:premium;product.createdAt:month:2024-10',

  // ============ WITH SORTING ============
  'product.status:eq:active;@sort:name',
  'product.price:between:100,500;@sort:-price',
  'product.createdAt:year:2024;@sort:-createdAt,name',

  // ============ WITH PAGINATION ============
  'product.isActive:eq:1;@limit:20',
  'product.tags:in:sale,new;@page:2',
  'product.stock:gte:10;@limit:50;@offset:100',
  'product.name:contains:pro;@page:3;@limit:25',

  // ============ WITH FIELD SELECTION ============
  'product.isActive:eq:1;@fields:id,name,price',
  'product.status:eq:active;@fields:id,sku,name,createdAt',
  'product.category.name:eq:electronics;@fields:id,name,category.name,brand.name',

  // ============ WITH INCLUDES/RELATIONS ============
  'product.status:eq:active;@include:category',
  'product.status:eq:active;@include:category,brand,reviews',
  'product.published:eq:true;@include:category,brand,supplier',

  // ============ COMPLETE QUERIES (ALL FEATURES) ============
  'product.status:eq:active;product.price:between:18,35;@sort:-createdAt;@limit:20;@page:1;@fields:id,name,price,stock;@include:category,brand',
  'product.price:gte:100;product.inStock:eq:true;product.categories:in:electronics,computers;@sort:-price;@limit:50;@fields:id,name,price,stock',

  // ============ SPECIAL & ESCAPED CHARACTERS ============
  'product.name:eq:John\\:Doe Sneaker',
  'product.path:contains:C\\:\\\\Catalog\\\\Images',
  'product.note:eq:Hello\\;World',
  'product.search:like:%20%25%',

  // ============ REAL-WORLD BUSINESS CASES ============
  'product.category:eq:electronics;product.price:between:100,1000;product.inStock:eq:true;product.tags:any:sale,bestseller;@sort:-rating;@limit:24',
  'product.brand:in:nike,adidas,puma;product.lastRestockedAt:gte:2024-10-01;product.isActive:eq:true;product.category.name:eq:footwear;@sort:-lastRestockedAt',
  'product.fulfillmentStatus:in:packed,shipped;product.stock:gte:500;product.createdAt:month:2024-10;product.supplier.vip:eq:true;@include:supplier,variants',
  'product.status:eq:published;product.views:gte:1000;product.tags:all:featured,trending;product.brand.status:eq:active;@sort:-publishedAt;@limit:10',
  'product.analyticsEventType:in:view,add_to_cart,purchase;product.value:gte:100;product.userId:isNotNull:true;product.timestamp:between:2024-10-01,2024-10-31;product.country:eq:US',
  'product.stock:lte:10;product.category:in:electronics,toys;product.supplier.status:eq:active;product.reorderPoint:gte:stock;@sort:stock',
  'product.catalogTier:eq:gold;product.margin:gte:5000;product.lastRestockedAt:gte:2024-09-01;product.supplier.email:isNotNull:true;@include:supplier;@fields:id,name,sku,margin',

  // ============ NEGATIVE / EDGE CASES ============
  'product.name:eq:NULL',
  'product.description:isNull:true',
  'product.description:contains:' + 'a'.repeat(500),
  'product.name:eq:José',
  'product.title:eq:Überprüfung',
  'product.city:eq:مشهد',
  'product.tags:any:new,sale,hot;product.colors:all:red,blue;product.sizes:in:S,M,L;@limit:100',

  // Deeply nested fields
  'product.category.parent.supplier.name:like:%amazon%',
  'product.inventory.location.warehouse.city:eq:Tehran',
  'product.specs.dimensions.width:gte:10',

  // ============ ADVANCED COMBINATIONS ============
  'product.createdAt:year:2024;product.status:in:active,pending;product.category.name:eq:footwear;product.tags:any:premium;@sort:-createdAt;@limit:50;@fields:id,name,status,createdAt;@include:category',
  'product.price:between:50,200;product.name:contains:pro;product.category:exists:true;product.inStock:eq:true;@sort:-price',
  'product.orders.status:eq:paid;product.orders.items.quantity:gte:2;product.customer.vip:eq:true;product.customer.profile.country:eq:USA;@include:orders,orders.items,customer.profile',

  // ============ OPERATOR-SPECIFIC EXAMPLES ============
  'product.field:eq:value',
  'product.field:neq:value',
  'product.field:gt:100',
  'product.field:gte:100',
  'product.field:lt:100',
  'product.field:lte:100',
  'product.field:between:10,20',
  'product.field:like:%pattern%',
  'product.field:iLike:%pattern%',
  'product.field:notLike:%spam%',
  'product.field:contains:substring',
  'product.field:startsWith:prefix',
  'product.field:endsWith:suffix',
  'product.field:regex:^[A-Z]+$',
  'product.field:in:value1,value2,value3',
  'product.field:notIn:excluded1,excluded2',
  'product.field:any:item1,item2',
  'product.field:all:required1,required2',
  'product.field:size:5',
  'product.field:isNull:true',
  'product.field:isNotNull:true',
  'product.field:exists:true',
  'product.field:notExists:true',
  'product.field:date:2024-01-01',
  'product.field:year:2024',
  'product.field:month:2024-05',
  'product.field:day:15',

  // ============ LARGE COMPLEX QUERIES ============
  'product.status:eq:active;product.price:between:25,40;product.shipFromCity:in:Tehran,Shiraz,Isfahan;product.tags:all:premium,verified;product.categories:any:technology,sports;product.lastViewedAt:gte:2024-10-01;product.orders_count:gte:5;@sort:-product.lastViewedAt,-product.orders_count;@limit:20;@page:2;@fields:id,name,sku,price,shipFromCity,tags,lastViewedAt,orders_count;@include:category,brand,reviews',
  'product.tenantId:eq:company_123;product.status:neq:archived;product.department:in:home,tech;product.manager:exists:true;product.projectCount:gte:1;@sort:department,name',
  'product.channel:in:web,app,marketplace;product.visibility:eq:public;product.likes:gte:100;product.reviews:exists:true;product.createdAt:day:15;product.brand.verified:eq:true;@sort:-likes,-createdAt;@limit:50;@include:brand,reviews,category',
  'product.shipFromCity:eq:Tehran;product.status:eq:active;product.variants.availableAt:gte:2024-01-01;product.specs.code:startsWith:SPEC-;product.features:any:insulation,waterproof;@include:variants,specs,features',
  'product.stockMovementType:in:restock,sale,adjustment;product.amount:between:100,10000;product.status:eq:completed;product.timestamp:year:2024;product.supplier.verified:eq:true;@sort:-timestamp;@limit:100;@fields:id,amount,type,timestamp,productId',
];
