export const sampleQueries = [
  // ============ BASIC OPERATORS ============
  // Equality
  'status:eq:active',
  'role:neq:guest',
  'isVerified:eq:true',
  'isDeleted:eq:false',

  // Comparison
  'age:gt:18',
  'price:gte:100',
  'stock:lt:50',
  'discount:lte:25',

  // Range
  'price:between:50,150',
  'age:between:18,65',
  'createdAt:between:2024-01-01,2024-12-31',

  // ============ STRING OPERATORS ============
  // Pattern matching
  'name:like:%john%',
  'email:iLike:%@gmail.com',
  'title:contains:urgent',
  'code:startsWith:ERR',
  'filename:endsWith:.pdf',
  'description:notLike:%spam%',

  // Regex
  'email:regex:^[a-z]+@[a-z]+\\.[a-z]{2,}$',
  'phone:regex:^\\+?[0-9]{10,15}$',

  // ============ ARRAY OPERATORS ============
  // In/NotIn
  'status:in:active,pending,approved',
  'priority:notIn:low,archived',
  'role:in:admin,manager,editor',

  // Array matching
  'tags:any:urgent,important',
  'permissions:all:read,write,delete',
  'sizes:size:3',
  'colors:size:0',

  // ============ NULL & BOOLEAN ============
  'deletedAt:isNull:true',
  'email:isNotNull:true',
  'active:eq:true',
  'isPremium:neq:false',
  'profile:exists:true',
  'orders:notExists:true',

  // ============ DATE & TIME ============
  // Exact date
  'createdAt:eq:2024-01-15',
  'birthDate:date:1990-05-20',

  // Date parts
  'createdAt:year:2024',
  'createdAt:month:2024-05',
  'createdAt:day:15',

  // Date ranges
  'createdAt:gt:2024-01-01',
  'updatedAt:lt:2024-12-31',
  'eventDate:between:2024-06-01,2024-08-31',

  // ============ NESTED FIELDS (DOT NOTATION) ============
  // Single level
  'user.profile.age:gte:18',
  'product.category.name:eq:electronics',
  'order.shipping.city:eq:Tehran',

  // Multiple levels
  'user.profile.address.country:eq:USA',
  'product.category.parent.name:eq:Electronics',

  // Nested with operators
  'user.orders.total:gte:100',
  'product.reviews.rating:gte:4',
  'post.comments.count:gte:5',

  // ============ RELATIONSHIP EXISTENCE ============
  'profile:exists:true',
  'orders:exists:true',
  'comments:notExists:true',
  'user.orders:exists:true',

  // ============ COMBINED CONDITIONS (AND) ============
  // Two conditions
  'status:eq:active;age:gte:18',
  'price:between:100,500;inStock:eq:true',

  // Three conditions
  'active:eq:1;role:in:admin,editor;createdAt:year:2024',
  'name:like:%john%;email:contains:@company.com;isVerified:eq:true',

  // Mixed types
  'age:gte:18;status:eq:active;tags:any:premium;createdAt:month:2024-10',

  // ============ WITH SORTING ============
  'status:eq:active;@sort:name',
  'price:between:100,500;@sort:-price',
  'createdAt:year:2024;@sort:-createdAt,name',

  // ============ WITH PAGINATION ============
  'active:eq:1;@limit:20',
  'status:in:active,pending;@page:2',
  'age:gte:18;@limit:50;@offset:100',
  'name:contains:john;@page:3;@limit:25',

  // ============ WITH FIELD SELECTION ============
  'active:eq:1;@fields:id,name,email',
  'role:eq:admin;@fields:id,username,role,createdAt',
  'status:eq:active;@fields:id,name,profile.avatar',

  // ============ WITH INCLUDES/RELATIONS ============
  'status:eq:active;@include:profile',
  'user.status:eq:active;@include:profile,orders',
  'post.published:eq:true;@include:author,comments,comments.user',

  // ============ COMPLETE QUERIES (ALL FEATURES) ============
  'status:eq:active;age:between:18,35;@sort:-createdAt;@limit:20;@page:1;@fields:id,name,email,age;@include:profile',
  'price:gte:100;inStock:eq:true;category:in:electronics,computers;@sort:-price;@limit:50;@fields:id,name,price,stock',

  // ============ SPECIAL & ESCAPED CHARACTERS ============
  'name:eq:John\\:Doe',
  'path:contains:C\\:\\\\Program Files',
  'note:eq:Hello\\;World',
  'search:like:%20%25%', // space, percent, space (URL encoded)

  // ============ REAL-WORLD BUSINESS CASES ============
  // E-commerce
  'category:eq:electronics;price:between:100,1000;inStock:eq:true;tags:any:sale,bestseller;@sort:-rating;@limit:24',

  // User management
  'role:in:admin,moderator;lastLoginAt:gte:2024-10-01;isActive:eq:true;profile.country:eq:USA;@sort:-lastLoginAt',

  // Order management
  'status:in:paid,shipped;total:gte:500;createdAt:month:2024-10;customer.vip:eq:true;@include:customer,items',

  // Content management
  'status:eq:published;views:gte:1000;tags:all:featured,trending;author.status:eq:active;@sort:-publishedAt;@limit:10',

  // Analytics
  'eventType:in:purchase,subscription;value:gte:100;userId:isNotNull:true;timestamp:between:2024-10-01,2024-10-31;country:eq:US',

  // Inventory
  'stock:lte:10;category:in:electronics,toys;supplier.status:eq:active;reorderPoint:gte:stock;@sort:stock',

  // CRM
  'customerTier:eq:gold;totalSpent:gte:5000;lastOrderAt:gte:2024-09-01;email:isNotNull:true;@include:orders;@fields:id,name,email,totalSpent',

  // ============ NEGATIVE / EDGE CASES ============
  // Empty values (should be handled by validator)
  'name:eq:NULL',
  'email:isNull:true',

  // Very long values (testing boundaries)
  'description:contains:' + 'a'.repeat(500),

  // Unicode values
  'name:eq:José',
  'title:eq:Überprüfung',
  'city:eq:مشهد',

  // Multiple array operators
  'tags:any:new,sale,hot;colors:all:red,blue;sizes:in:S,M,L;@limit:100',

  // Deeply nested fields
  'user.profile.address.city:eq:Tehran',
  'product.category.parent.supplier.name:like:%amazon%',
  'order.customer.profile.preferences.theme:eq:dark',

  // ============ ADVANCED COMBINATIONS ============
  // Date + array + nested
  'createdAt:year:2024;status:in:active,pending;user.profile.country:eq:Canada;tags:any:premium;@sort:-createdAt;@limit:50;@fields:id,name,status,createdAt;@include:profile',

  // Numeric ranges + string search + existence
  'price:between:50,200;name:contains:pro;category:exists:true;inStock:eq:true;@sort:-price',

  // Multiple relationships
  'orders.status:eq:paid;orders.items.quantity:gte:2;customer.vip:eq:true;customer.profile.country:eq:USA;@include:orders,orders.items,customer.profile',

  // ============ OPERATOR-SPECIFIC EXAMPLES ============
  // Each operator used individually
  'field:eq:value',
  'field:neq:value',
  'field:gt:100',
  'field:gte:100',
  'field:lt:100',
  'field:lte:100',
  'field:between:10,20',
  'field:like:%pattern%',
  'field:iLike:%pattern%',
  'field:notLike:%spam%',
  'field:contains:substring',
  'field:startsWith:prefix',
  'field:endsWith:suffix',
  'field:regex:^[A-Z]+$',
  'field:in:value1,value2,value3',
  'field:notIn:excluded1,excluded2',
  'field:any:item1,item2',
  'field:all:required1,required2',
  'field:size:5',
  'field:isNull:true',
  'field:isNotNull:true',
  'field:exists:true',
  'field:notExists:true',
  'field:date:2024-01-01',
  'field:year:2024',
  'field:month:2024-05',
  'field:day:15',

  // ============ LARGE COMPLEX QUERIES ============
  // Full-featured API request example
  'status:eq:active;age:between:25,40;city:in:Tehran,Shiraz,Isfahan;tags:all:premium,verified;profile.interests:any:technology,sports;lastLogin:gte:2024-10-01;orders_count:gte:5;@sort:-lastLogin,-orders_count;@limit:20;@page:2;@fields:id,name,email,age,city,tags,lastLogin,orders_count;@include:profile,orders,orders.items',

  // Multi-tenant example
  'tenantId:eq:company_123;role:neq:guest;department:in:engineering,product;manager:exists:true;projects.size:gte:1;@sort:department,name',

  // Social media feed
  'type:in:post,share;visibility:eq:public;likes:gte:100;comments:exists:true;createdAt:day:15;author.verified:eq:true;@sort:-likes,-createdAt;@limit:50;@include:author,comments,comments.author',

  // Healthcare system
  'patientId:eq:PAT-12345;status:eq:active;appointments.date:gte:2024-01-01;diagnosis.code:startsWith:ICD-10;medications:any:insulin,metformin;@include:appointments,diagnosis,medications',

  // Financial transactions
  'type:in:deposit,withdrawal;amount:between:100,10000;status:eq:completed;timestamp:year:2024;account.verified:eq:true;@sort:-timestamp;@limit:100;@fields:id,amount,type,timestamp,accountId',
];
