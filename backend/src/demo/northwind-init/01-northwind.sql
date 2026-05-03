-- Northwind trading-company demo schema for db-cosmos
-- 11 tables, rich FK relationships, ~600 rows seeded
-- Postgres-compatible port of the classic Microsoft Northwind sample.
-- License: public domain / free to use (data is synthetic/derivative of public Northwind samples).
SET client_min_messages = warning;

-- ── Schema ───────────────────────────────────────────────────────────────────

CREATE TABLE categories (
  category_id   SERIAL PRIMARY KEY,
  category_name VARCHAR(15)  NOT NULL,
  description   TEXT
);

CREATE TABLE suppliers (
  supplier_id   SERIAL PRIMARY KEY,
  company_name  VARCHAR(40)  NOT NULL,
  contact_name  VARCHAR(30),
  contact_title VARCHAR(30),
  address       VARCHAR(60),
  city          VARCHAR(20),
  region        VARCHAR(15),
  postal_code   VARCHAR(10),
  country       VARCHAR(20),
  phone         VARCHAR(24)
);

CREATE TABLE products (
  product_id        SERIAL PRIMARY KEY,
  product_name      VARCHAR(40)    NOT NULL,
  supplier_id       INT            REFERENCES suppliers(supplier_id),
  category_id       INT            REFERENCES categories(category_id),
  quantity_per_unit VARCHAR(20),
  unit_price        NUMERIC(10,2)  NOT NULL DEFAULT 0,
  units_in_stock    SMALLINT       NOT NULL DEFAULT 0,
  units_on_order    SMALLINT       NOT NULL DEFAULT 0,
  reorder_level     SMALLINT       NOT NULL DEFAULT 0,
  discontinued      BOOL           NOT NULL DEFAULT FALSE
);

CREATE TABLE customers (
  customer_id   CHAR(5)      PRIMARY KEY,
  company_name  VARCHAR(40)  NOT NULL,
  contact_name  VARCHAR(30),
  contact_title VARCHAR(30),
  address       VARCHAR(60),
  city          VARCHAR(20),
  region        VARCHAR(15),
  postal_code   VARCHAR(10),
  country       VARCHAR(20),
  phone         VARCHAR(24)
);

CREATE TABLE region (
  region_id          SERIAL      PRIMARY KEY,
  region_description CHAR(50)    NOT NULL
);

CREATE TABLE territories (
  territory_id          VARCHAR(20)  PRIMARY KEY,
  territory_description CHAR(50)     NOT NULL,
  region_id             INT          NOT NULL REFERENCES region(region_id)
);

CREATE TABLE employees (
  employee_id       SERIAL      PRIMARY KEY,
  last_name         VARCHAR(20) NOT NULL,
  first_name        VARCHAR(10) NOT NULL,
  title             VARCHAR(30),
  birth_date        DATE,
  hire_date         DATE,
  address           VARCHAR(60),
  city              VARCHAR(15),
  country           VARCHAR(15),
  home_phone        VARCHAR(24),
  reports_to        INT         REFERENCES employees(employee_id)
);

CREATE TABLE employee_territories (
  employee_id  INT         NOT NULL REFERENCES employees(employee_id),
  territory_id VARCHAR(20) NOT NULL REFERENCES territories(territory_id),
  PRIMARY KEY (employee_id, territory_id)
);

CREATE TABLE shippers (
  shipper_id   SERIAL      PRIMARY KEY,
  company_name VARCHAR(40) NOT NULL,
  phone        VARCHAR(24)
);

CREATE TABLE orders (
  order_id        SERIAL        PRIMARY KEY,
  customer_id     CHAR(5)       REFERENCES customers(customer_id),
  employee_id     INT           REFERENCES employees(employee_id),
  order_date      DATE,
  required_date   DATE,
  shipped_date    DATE,
  ship_via        INT           REFERENCES shippers(shipper_id),
  freight         NUMERIC(10,2) NOT NULL DEFAULT 0,
  ship_name       VARCHAR(40),
  ship_city       VARCHAR(20),
  ship_country    VARCHAR(20)
);

CREATE TABLE order_details (
  order_id    INT           NOT NULL REFERENCES orders(order_id),
  product_id  INT           NOT NULL REFERENCES products(product_id),
  unit_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  quantity    SMALLINT      NOT NULL DEFAULT 1,
  discount    REAL          NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, product_id)
);

-- ── Seed data ────────────────────────────────────────────────────────────────

INSERT INTO categories (category_id, category_name, description) VALUES
  (1, 'Beverages',      'Soft drinks, coffees, teas, beers, and ales'),
  (2, 'Condiments',     'Sweet and savory sauces, relishes, spreads, and seasonings'),
  (3, 'Confections',    'Desserts, candies, and sweet breads'),
  (4, 'Dairy Products', 'Cheeses'),
  (5, 'Grains/Cereals', 'Breads, crackers, pasta, and cereal'),
  (6, 'Meat/Poultry',   'Prepared meats'),
  (7, 'Produce',        'Dried fruit and bean curd'),
  (8, 'Seafood',        'Seaweed and fish');
SELECT setval('categories_category_id_seq', 8);

INSERT INTO suppliers (supplier_id, company_name, contact_name, contact_title, city, country, phone) VALUES
  ( 1, 'Exotic Liquids',              'Charlotte Cooper',    'Purchasing Manager',    'London',     'UK',        '(171) 555-2222'),
  ( 2, 'New Orleans Cajun Delights',  'Shelley Burke',       'Order Administrator',   'New Orleans','USA',       '(100) 555-4822'),
  ( 3, 'Grandma Kelly''s Homestead',  'Regina Murphy',       'Sales Representative',  'Ann Arbor',  'USA',       '(313) 555-5735'),
  ( 4, 'Tokyo Traders',               'Yoshi Nagase',        'Marketing Manager',     'Tokyo',      'Japan',     '(03) 3555-5011'),
  ( 5, 'Cooperativa de Quesos',        'Antonio del Valle',  'Export Administrator',  'Oviedo',     'Spain',     '(98) 598 76 54'),
  ( 6, 'Mayumi''s',                   'Mayumi Ohno',         'Marketing Representative','Osaka',    'Japan',     '(06) 431-7877'),
  ( 7, 'Pavlova Ltd.',                'Ian Devling',         'Marketing Manager',     'Melbourne',  'Australia', '(03) 444-2343'),
  ( 8, 'Specialty Biscuits Ltd.',     'Peter Wilson',        'Sales Representative',  'Manchester', 'UK',        '(161) 555-4448'),
  ( 9, 'PB Knäckebröd AB',            'Lars Peterson',       'Sales Agent',           'Göteborg',   'Sweden',    '031-987 65 43'),
  (10, 'Refrescos Americanas LTDA',   'Carlos Diaz',         'Marketing Manager',     'Sao Paulo',  'Brazil',    '(11) 555 4640'),
  (11, 'Heli Süßwaren GmbH',          'Petra Winkler',       'Sales Manager',         'Berlin',     'Germany',   '(010) 9984510'),
  (12, 'Plutzer Lebensmittel AG',     'Martin Bein',         'International Marketing','Frankfurt', 'Germany',   '(069) 992755'),
  (13, 'Nord-Ost-Fisch GmbH',         'Sven Petersen',       'Coordinator Foreign Markets','Cuxhaven','Germany', '(04721) 8713'),
  (14, 'Formaggi Fortini s.r.l.',     'Elio Rossi',          'Sales Representative',  'Ravenna',    'Italy',     '(0544) 60323'),
  (15, 'Norske Meierier',             'Beate Vileid',        'Marketing Manager',     'Sandvika',   'Norway',    '(0)2-953010');
SELECT setval('suppliers_supplier_id_seq', 15);

INSERT INTO products (product_id, product_name, supplier_id, category_id, quantity_per_unit, unit_price, units_in_stock, units_on_order, reorder_level, discontinued) VALUES
  ( 1, 'Chai',                         1,  1, '10 boxes x 20 bags',    18.00,  39,  0,  10, false),
  ( 2, 'Chang',                         1,  1, '24 - 12 oz bottles',    19.00,  17, 40,  25, false),
  ( 3, 'Aniseed Syrup',                 1,  2, '12 - 550 ml bottles',   10.00,  13, 70,  25, false),
  ( 4, 'Chef Anton''s Cajun Seasoning', 2,  2, '48 - 6 oz jars',        22.00,  53,  0,   0, false),
  ( 5, 'Chef Anton''s Gumbo Mix',       2,  2, '36 boxes',              21.35,   0,  0,   0, true),
  ( 6, 'Grandma''s Boysenberry Spread', 3,  2, '12 - 8 oz jars',        25.00, 120,  0,  25, false),
  ( 7, 'Uncle Bob''s Organic Dried Pears',3,7,'12 - 1 lb pkgs.',        30.00,  15,  0,  10, false),
  ( 8, 'Northwoods Cranberry Sauce',    3,  2, '12 - 12 oz jars',       40.00,   6,  0,   0, false),
  ( 9, 'Mishi Kobe Niku',               4,  6, '18 - 500 g pkgs.',      97.00,  29,  0,   0, true),
  (10, 'Ikura',                          4,  8, '12 - 200 ml jars',     31.00,  31,  0,   0, false),
  (11, 'Queso Cabrales',                5,  4, '1 kg pkg.',             21.00,  22, 30,  30, false),
  (12, 'Queso Manchego La Pastora',     5,  4, '10 - 500 g pkgs.',      38.00,  86,  0,   0, false),
  (13, 'Konbu',                          6,  8, '2 kg box',              6.00,  24,  0,   5, false),
  (14, 'Tofu',                           6,  7, '40 - 100 g pkgs.',     23.25,  35,  0,   0, false),
  (15, 'Genen Shouyu',                  6,  2, '24 - 250 ml bottles',   15.50,  39,  0,   5, false),
  (16, 'Pavlova',                        7,  3, '32 - 500 g boxes',     17.45, 175,  0,  25, false),
  (17, 'Alice Mutton',                  7,  6, '20 - 1 kg tins',        39.00,   0,  0,   0, true),
  (18, 'Carnarvon Tigers',              7,  8, '16 kg pkg.',            62.50,  42,  0,   0, false),
  (19, 'Teatime Chocolate Biscuits',    8,  3, '10 boxes x 12 pieces',   9.20,  25,  0,   5, false),
  (20, 'Sir Rodney''s Marmalade',       8,  3, '30 gift boxes',         81.00,  40,  0,   0, false),
  (21, 'Sir Rodney''s Scones',          8,  3, '24 pkgs. x 4 pieces',   10.00,   3, 40,   5, false),
  (22, 'Gustaf''s Knäckebröd',          9,  5, '24 - 500 g pkgs.',      21.00,  104, 0,  25, false),
  (23, 'Tunnbröd',                       9,  5, '12 - 250 g pkgs.',      9.00,  61,  0,  25, false),
  (24, 'Guaraná Fantástica',            10,  1, '12 - 355 ml cans',      4.50,  20,  0,   0, true),
  (25, 'NuNuCa Nuß-Nougat-Creme',      11,  3, '20 - 450 g glasses',   14.00,  76,  0,  30, false),
  (26, 'Gumbär Gummibärchen',          11,  3, '100 - 250 g bags',     31.23,  15,  0,   0, false),
  (27, 'Schoggi Schokolade',           11,  3, '100 - 100 g pieces',   43.90,  49,  0,  30, false),
  (28, 'Rössle Sauerkraut',            12,  7, '25 - 825 g cans',      45.60,  26,  0,   0, true),
  (29, 'Thüringer Rostbratwurst',      12,  6, '50 bags x 30 sausgs.', 123.79,  0,  0,   0, true),
  (30, 'Nord-Ost Matjeshering',        13,  8, '10 - 200 g glasses',   25.89,  10,  0,  15, false);
SELECT setval('products_product_id_seq', 30);

INSERT INTO customers (customer_id, company_name, contact_name, contact_title, address, city, country, phone) VALUES
  ('ALFKI', 'Alfreds Futterkiste',          'Maria Anders',    'Sales Representative', 'Obere Str. 57',          'Berlin',       'Germany',   '030-0074321'),
  ('ANATR', 'Ana Trujillo Emparedados',     'Ana Trujillo',    'Owner',                'Avda. de la Constitución','México D.F.', 'Mexico',    '(5) 555-4729'),
  ('ANTON', 'Antonio Moreno Taquería',      'Antonio Moreno',  'Owner',                'Mataderos 2312',          'México D.F.', 'Mexico',    '(5) 555-3932'),
  ('AROUT', 'Around the Horn',             'Thomas Hardy',    'Sales Representative', '120 Hanover Sq.',         'London',      'UK',        '(171) 555-7788'),
  ('BERGS', 'Berglunds snabbköp',          'Christina Berglund','Order Administrator','Berguvsvägen 8',          'Luleå',       'Sweden',    '0921-12 34 65'),
  ('BLAUS', 'Blauer See Delikatessen',      'Hanna Moos',      'Sales Representative', 'Forsterstr. 57',          'Mannheim',    'Germany',   '0621-08460'),
  ('BLONP', 'Blondesddsl père et fils',    'Frédérique Citeaux','Marketing Manager',  '24, place Kléber',        'Strasbourg',  'France',    '88.60.15.31'),
  ('BOLID', 'Bólido Comidas preparadas',   'Martín Sommer',   'Owner',                'C/ Araquil, 67',          'Madrid',      'Spain',     '(91) 555 22 82'),
  ('BONAP', 'Bon app''',                   'Laurence Lebihan', 'Owner',               '12, rue des Bouchers',    'Marseille',   'France',    '91.24.45.40'),
  ('BOTTM', 'Bottom-Dollar Markets',       'Elizabeth Lincoln','Accounting Manager',  '23 Tsawassen Blvd.',      'Tsawassen',   'Canada',    '(604) 555-4729'),
  ('BSBEV', 'B''s Beverages',              'Victoria Ashworth','Sales Representative','Fauntleroy Circus',       'London',      'UK',        '(171) 555-1212'),
  ('CACTU', 'Cactus Comidas para llevar',  'Patricio Simpson', 'Sales Agent',         'Cerrito 333',             'Buenos Aires','Argentina', '(1) 135-5555'),
  ('CENTC', 'Centro comercial Moctezuma',  'Francisco Chang',  'Marketing Manager',   'Sierras de Granada 9993', 'México D.F.', 'Mexico',    '(5) 555-3392'),
  ('CHOPS', 'Chop-suey Chinese',           'Yang Wang',        'Owner',               'Hauptstr. 29',            'Bern',        'Switzerland','0452-076545'),
  ('COMMI', 'Comércio Mineiro',            'Pedro Afonso',     'Sales Associate',     'Av. dos Lusíadas, 23',   'São Paulo',   'Brazil',    '(11) 555-7647'),
  ('CONSH', 'Consolidated Holdings',       'Elizabeth Brown',  'Sales Representative','Berkeley Gardens 12 Brewery Close','London','UK', '(171) 555-2282'),
  ('DRACD', 'Drachenblut Delikatessen',    'Sven Ottlieb',     'Order Administrator', 'Walserweg 21',            'Aachen',      'Germany',   '0241-039123'),
  ('DUMON', 'Du monde entier',             'Janine Labrune',   'Owner',               '67, rue des Cinquante Otages','Nantes',  'France',    '40.67.88.88'),
  ('EASTC', 'Eastern Connection',          'Ann Devon',        'Sales Agent',         '35 King George',          'London',      'UK',        '(171) 555-0297'),
  ('ERNSH', 'Ernst Handel',                'Roland Mendel',    'Sales Manager',       'Kirchgasse 6',            'Graz',        'Austria',   '7675-3425'),
  ('FAMIA', 'Familia Arquibaldo',          'Aria Cruz',        'Marketing Assistant', 'Rua Orós, 92',            'São Paulo',   'Brazil',    '(11) 555-9857'),
  ('FISSA', 'FISSA Fabrica Inter. Salchichas','Diego Roel','Accounting Manager','C/ Moralzarzal, 86',            'Madrid',      'Spain',     '(91) 555 94 44'),
  ('FOLIG', 'Folies gourmandes',           'Martine Rancé',    'Assistant Sales Agent','184, chaussée de Tournai','Lille',      'France',    '20.16.10.16'),
  ('FOLKO', 'Folk och fä HB',              'Maria Larsson',    'Owner',               'Åkergatan 24',            'Bräcke',      'Sweden',    '0695-34 67 21'),
  ('FRANK', 'Frankenversand',              'Peter Franken',    'Marketing Manager',   'Berliner Platz 43',       'München',     'Germany',   '089-0877310');

INSERT INTO region (region_id, region_description) VALUES
  (1, 'Eastern'),
  (2, 'Western'),
  (3, 'Northern'),
  (4, 'Southern');
SELECT setval('region_region_id_seq', 4);

INSERT INTO territories (territory_id, territory_description, region_id) VALUES
  ('01581', 'Westboro',          1),
  ('01730', 'Bedford',           1),
  ('01833', 'Georgetown',        1),
  ('02116', 'Boston',            1),
  ('02139', 'Cambridge',         1),
  ('02184', 'Braintree',         1),
  ('02903', 'Providence',        1),
  ('03049', 'Hollis',            3),
  ('03801', 'Portsmouth',        3),
  ('04019', 'Portland',          3),
  ('10019', 'New York',          1),
  ('10038', 'New York City',     1),
  ('11747', 'Melville',          1),
  ('14450', 'Fairport',          1),
  ('19428', 'Philadelphia',      1),
  ('20852', 'Rockville',         1),
  ('27403', 'Greensboro',        1),
  ('44122', 'Beachwood',         2),
  ('45839', 'Findlay',           2),
  ('48075', 'Southfield',        2),
  ('55113', 'Roseville',         2),
  ('60179', 'Hoffman Estates',   2),
  ('72716', 'Bentonville',       4),
  ('75234', 'Dallas',            4),
  ('78759', 'Austin',            4),
  ('94025', 'Menlo Park',        2),
  ('94105', 'San Francisco',     2),
  ('95054', 'Santa Clara',       2),
  ('98004', 'Bellevue',          2),
  ('98052', 'Redmond',           2);

INSERT INTO employees (employee_id, last_name, first_name, title, birth_date, hire_date, city, country, home_phone, reports_to) VALUES
  (1, 'Davolio',   'Nancy',  'Sales Representative',           '1948-12-08', '1992-05-01', 'Seattle',  'USA', '(206) 555-9857', 2),
  (2, 'Fuller',    'Andrew', 'Vice President, Sales',          '1952-02-19', '1992-08-14', 'Tacoma',   'USA', '(206) 555-9482', NULL),
  (3, 'Leverling', 'Janet',  'Sales Representative',           '1963-08-30', '1992-04-01', 'Kirkland', 'USA', '(206) 555-3412', 2),
  (4, 'Peacock',   'Margaret','Sales Representative',          '1937-09-19', '1993-05-03', 'Redmond',  'USA', '(206) 555-8122', 2),
  (5, 'Buchanan',  'Steven', 'Sales Manager',                  '1955-03-04', '1993-10-17', 'London',   'UK',  '(71) 555-4848',  2),
  (6, 'Suyama',    'Michael','Sales Representative',           '1963-07-02', '1993-10-17', 'London',   'UK',  '(71) 555-7773',  5),
  (7, 'King',      'Robert', 'Sales Representative',           '1960-05-29', '1994-01-02', 'London',   'UK',  '(71) 555-5598',  5),
  (8, 'Callahan',  'Laura',  'Inside Sales Coordinator',       '1958-01-09', '1994-03-05', 'Seattle',  'USA', '(206) 555-1189', 2),
  (9, 'Dodsworth', 'Anne',   'Sales Representative',           '1966-01-27', '1994-11-15', 'London',   'UK',  '(71) 555-4444',  5);
SELECT setval('employees_employee_id_seq', 9);

-- Territory IDs here MUST exist in the territories table above
INSERT INTO employee_territories (employee_id, territory_id) VALUES
  (1,'01581'),(1,'02116'),
  (2,'01730'),(2,'01833'),(2,'02139'),(2,'02184'),(2,'10019'),(2,'10038'),(2,'11747'),
  (3,'44122'),(3,'45839'),(3,'48075'),(3,'55113'),
  (4,'20852'),(4,'27403'),
  (5,'02903'),(5,'03049'),(5,'03801'),(5,'04019'),(5,'14450'),
  (6,'94025'),(6,'94105'),(6,'95054'),(6,'98004'),(6,'98052'),
  (7,'60179'),(7,'72716'),(7,'75234'),
  (8,'19428'),(8,'44122'),(8,'45839'),(8,'48075'),
  (9,'01833'),(9,'78759'),(9,'94025')
ON CONFLICT DO NOTHING;

INSERT INTO shippers (shipper_id, company_name, phone) VALUES
  (1, 'Speedy Express',  '(503) 555-9831'),
  (2, 'United Package',  '(503) 555-3199'),
  (3, 'Federal Shipping','(503) 555-9931');
SELECT setval('shippers_shipper_id_seq', 3);

-- ── Generate 120 orders spread across customers and employees ──────────────

INSERT INTO orders (customer_id, employee_id, order_date, required_date, shipped_date, ship_via, freight, ship_name, ship_city, ship_country)
SELECT
  c.customer_id,
  1 + (gs % 9),
  DATE '1996-07-04' + (gs * 2),
  DATE '1996-07-04' + (gs * 2) + 14,
  CASE WHEN gs % 10 != 0 THEN DATE '1996-07-04' + (gs * 2) + 5 ELSE NULL END,
  1 + (gs % 3),
  ROUND((2.0 + gs * 0.6)::numeric, 2),
  c.company_name,
  c.city,
  c.country
FROM generate_series(0, 119) AS gs
CROSS JOIN LATERAL (
  SELECT customer_id, company_name, city, country
  FROM customers
  ORDER BY customer_id
  OFFSET gs % 25 LIMIT 1
) c;

-- ── Generate ~2 order_details per order (240 rows) ─────────────────────────

INSERT INTO order_details (order_id, product_id, unit_price, quantity, discount)
SELECT
  o.order_id,
  p.product_id,
  p.unit_price,
  1 + (o.order_id % 5),
  CASE WHEN o.order_id % 7 = 0 THEN 0.1
       WHEN o.order_id % 11 = 0 THEN 0.15
       ELSE 0 END
FROM orders o
CROSS JOIN LATERAL (
  SELECT product_id, unit_price
  FROM products
  ORDER BY product_id
  OFFSET o.order_id % 28 LIMIT 2
) p
ON CONFLICT DO NOTHING;

-- ── Final ANALYZE to populate pg_stat_user_tables row counts ────────────────
ANALYZE;
