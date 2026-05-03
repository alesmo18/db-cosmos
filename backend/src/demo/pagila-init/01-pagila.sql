-- Pagila-style movie rental demo schema for db-cosmos
-- 15 tables, rich FK relationships, ~400 rows seeded
SET client_min_messages = warning;

-- ── Reference tables ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS country (
  country_id   SERIAL PRIMARY KEY,
  country      VARCHAR(50) NOT NULL,
  last_update  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS city (
  city_id      SERIAL PRIMARY KEY,
  city         VARCHAR(50) NOT NULL,
  country_id   INTEGER NOT NULL REFERENCES country(country_id),
  last_update  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS address (
  address_id   SERIAL PRIMARY KEY,
  address      VARCHAR(50) NOT NULL,
  district     VARCHAR(20) NOT NULL DEFAULT '',
  city_id      INTEGER NOT NULL REFERENCES city(city_id),
  postal_code  VARCHAR(10),
  phone        VARCHAR(20) NOT NULL DEFAULT '',
  last_update  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS language (
  language_id  SERIAL PRIMARY KEY,
  name         VARCHAR(20) NOT NULL,
  last_update  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS category (
  category_id  SERIAL PRIMARY KEY,
  name         VARCHAR(25) NOT NULL,
  last_update  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Film catalogue ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS actor (
  actor_id     SERIAL PRIMARY KEY,
  first_name   VARCHAR(45) NOT NULL,
  last_name    VARCHAR(45) NOT NULL,
  last_update  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS film (
  film_id           SERIAL PRIMARY KEY,
  title             VARCHAR(128) NOT NULL,
  description       TEXT,
  release_year      INTEGER,
  language_id       INTEGER NOT NULL REFERENCES language(language_id),
  rental_duration   SMALLINT NOT NULL DEFAULT 3,
  rental_rate       NUMERIC(4,2) NOT NULL DEFAULT 4.99,
  length            SMALLINT,
  replacement_cost  NUMERIC(5,2) NOT NULL DEFAULT 19.99,
  rating            VARCHAR(10) DEFAULT 'G',
  last_update       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS film_actor (
  actor_id     INTEGER NOT NULL REFERENCES actor(actor_id),
  film_id      INTEGER NOT NULL REFERENCES film(film_id),
  last_update  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor_id, film_id)
);

CREATE TABLE IF NOT EXISTS film_category (
  film_id      INTEGER NOT NULL REFERENCES film(film_id),
  category_id  INTEGER NOT NULL REFERENCES category(category_id),
  last_update  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (film_id, category_id)
);

-- ── Store operations ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS store (
  store_id         SERIAL PRIMARY KEY,
  manager_staff_id INTEGER,          -- FK added after staff insert
  address_id       INTEGER NOT NULL REFERENCES address(address_id),
  last_update      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff (
  staff_id     SERIAL PRIMARY KEY,
  first_name   VARCHAR(45) NOT NULL,
  last_name    VARCHAR(45) NOT NULL,
  address_id   INTEGER NOT NULL REFERENCES address(address_id),
  email        VARCHAR(50),
  store_id     INTEGER NOT NULL REFERENCES store(store_id),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  username     VARCHAR(16) NOT NULL,
  last_update  TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE store
  ADD CONSTRAINT fk_store_manager FOREIGN KEY (manager_staff_id) REFERENCES staff(staff_id);

CREATE TABLE IF NOT EXISTS customer (
  customer_id  SERIAL PRIMARY KEY,
  store_id     INTEGER NOT NULL REFERENCES store(store_id),
  first_name   VARCHAR(45) NOT NULL,
  last_name    VARCHAR(45) NOT NULL,
  email        VARCHAR(50),
  address_id   INTEGER NOT NULL REFERENCES address(address_id),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  create_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  last_update  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory (
  inventory_id  SERIAL PRIMARY KEY,
  film_id       INTEGER NOT NULL REFERENCES film(film_id),
  store_id      INTEGER NOT NULL REFERENCES store(store_id),
  last_update   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rental (
  rental_id     SERIAL PRIMARY KEY,
  rental_date   TIMESTAMP NOT NULL,
  inventory_id  INTEGER NOT NULL REFERENCES inventory(inventory_id),
  customer_id   INTEGER NOT NULL REFERENCES customer(customer_id),
  return_date   TIMESTAMP,
  staff_id      INTEGER NOT NULL REFERENCES staff(staff_id),
  last_update   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment (
  payment_id    SERIAL PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customer(customer_id),
  staff_id      INTEGER NOT NULL REFERENCES staff(staff_id),
  rental_id     INTEGER NOT NULL REFERENCES rental(rental_id),
  amount        NUMERIC(5,2) NOT NULL,
  payment_date  TIMESTAMP NOT NULL,
  last_update   TIMESTAMP DEFAULT NOW()
);

-- ── Seed data ────────────────────────────────────────────────────────────────

INSERT INTO country (country) VALUES
  ('United States'),('Canada'),('United Kingdom'),('France'),('Germany'),
  ('Japan'),('Australia'),('Brazil'),('Mexico'),('Spain')
ON CONFLICT DO NOTHING;

INSERT INTO city (city, country_id) VALUES
  ('New York',1),('Los Angeles',1),('Chicago',1),('Toronto',2),('Vancouver',2),
  ('London',3),('Paris',4),('Berlin',5),('Tokyo',6),('Sydney',7),
  ('São Paulo',8),('Mexico City',9),('Barcelona',10),('Montreal',2),('Houston',1)
ON CONFLICT DO NOTHING;

INSERT INTO address (address, district, city_id, postal_code, phone) VALUES
  ('100 Main St','Manhattan',1,'10001','212-555-0101'),
  ('200 Sunset Blvd','Hollywood',2,'90028','323-555-0102'),
  ('300 Lake Shore Dr','Lincoln Park',3,'60657','312-555-0103'),
  ('400 Bay St','Financial',4,'M5H 2Y4','416-555-0104'),
  ('500 Robson St','Downtown',5,'V6B 2B5','604-555-0105'),
  ('600 Baker St','Westminster',6,'W1U 6TL','020-555-0106'),
  ('700 Champs-Élysées','8th',7,'75008','01-555-0107'),
  ('800 Unter den Linden','Mitte',8,'10117','030-555-0108'),
  ('900 Shibuya','Shibuya',9,'150-0002','03-555-0109'),
  ('1000 George St','CBD',10,'2000','02-555-0110'),
  ('1100 Paulista Ave','Bela Vista',11,'01310','11-555-0111'),
  ('1200 Paseo de Reforma','Cuauhtémoc',12,'06500','55-555-0112'),
  ('1300 Las Ramblas','Gràcia',13,'08007','93-555-0113'),
  ('1400 Peel St','Downtown',14,'H3A 2H6','514-555-0114'),
  ('1500 Travis St','Midtown',15,'77002','713-555-0115')
ON CONFLICT DO NOTHING;

INSERT INTO language (name) VALUES
  ('English'),('Italian'),('Japanese'),('Mandarin'),('French'),
  ('German'),('Spanish'),('Portuguese')
ON CONFLICT DO NOTHING;

INSERT INTO category (name) VALUES
  ('Action'),('Animation'),('Children'),('Classics'),('Comedy'),
  ('Documentary'),('Drama'),('Family'),('Foreign'),('Games'),
  ('Horror'),('Music'),('New'),('Sci-Fi'),('Sports'),('Travel')
ON CONFLICT DO NOTHING;

INSERT INTO actor (first_name, last_name) VALUES
  ('PENELOPE','GUINESS'),('NICK','WAHLBERG'),('ED','CHASE'),('JENNIFER','DAVIS'),
  ('JOHNNY','LOLLOBRIGIDA'),('BETTE','NICHOLSON'),('GRACE','MOSTEL'),('MATTHEW','JOHANSSON'),
  ('JOE','SWANK'),('CHRISTIAN','GABLE'),('ZERO','CAGE'),('KARL','BERRY'),
  ('UMA','WOOD'),('VIVIEN','BERGEN'),('CUBA','OLIVIER'),('FRED','COSTNER'),
  ('HELEN','VOIGHT'),('DAN','TORN'),('BOB','FAWCETT'),('LUCILLE','TRACY')
ON CONFLICT DO NOTHING;

INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating) VALUES
  ('ACADEMY DINOSAUR','Epic Drama about a Feminist And a Mad Scientist',2006,1,6,0.99,86,20.99,'PG'),
  ('ACE GOLDFINGER','Astounding Epistle of a Database Administrator',2006,1,3,4.99,48,12.99,'G'),
  ('ADAPTATION HOLES','Astounding Reflections of a Lumberjack',2006,1,7,2.99,50,18.99,'NC-17'),
  ('AFFAIR PREJUDICE','Fanciful Documentary of a Frisbee',2006,1,5,2.99,117,26.99,'G'),
  ('AFRICAN EGG','Unique Drama of a Feminist',2006,1,6,2.99,130,22.99,'G'),
  ('AGENT TRUMAN','Intrepid Panorama of a Robot',2006,1,3,2.99,169,17.99,'PG'),
  ('AIRPLANE SIERRA','Trivial Saga of a Hunter',2006,1,6,4.99,62,28.99,'PG-13'),
  ('AIRPORT POLLOCK','Brilliant Formula of a Monkey',2006,1,6,4.99,54,15.99,'R'),
  ('ALABAMA DEVIL','Thoughtful Panorama of a Database Administrator',2006,1,3,2.99,114,21.99,'PG-13'),
  ('ALADDIN CALENDAR','Drama of a Technical Writer',2006,1,6,4.99,63,29.99,'NC-17'),
  ('ALAMO VIDEOTAPE','Boring Epistle of a Butler',2006,1,6,0.99,126,16.99,'G'),
  ('ALASKA PHANTOM','Fanciful Saga of a Hunter',2006,1,6,0.99,136,22.99,'PG'),
  ('ALI FOREVER','Action-Packed Drama of a Dentist',2006,1,4,4.99,150,21.99,'PG'),
  ('ALICE FANTASIA','Fantasy of a Technical Writer',2006,2,6,0.99,94,23.99,'NC-17'),
  ('ALIEN CENTER','Brilliant Drama of a Cat',2006,1,5,2.99,46,10.99,'NC-17'),
  ('ALLEY EVOLUTION','Amazing Panorama of a Dentist',2006,1,6,2.99,180,23.99,'NC-17'),
  ('ALONE TRIP','Close-Up of a Composer',2006,1,3,0.99,82,14.99,'R'),
  ('ALTERATION TANGO','Fascinating Reflection of a Pastry Chef',2006,1,3,0.99,106,27.99,'NC-17'),
  ('AMADEUS HOLY','Dramatic Composition of a Pioneer',2006,1,6,0.99,113,20.99,'PG'),
  ('AMELIE HELLFIGHTERS','Unbelieveable Yarn of a Boat',2006,1,4,4.99,79,19.99,'R')
ON CONFLICT DO NOTHING;

-- film_actor assignments
INSERT INTO film_actor (actor_id, film_id) VALUES
  (1,1),(1,6),(1,14),(2,2),(2,7),(2,15),(3,3),(3,8),(3,16),(4,4),(4,9),(4,17),
  (5,5),(5,10),(5,18),(6,1),(6,11),(6,19),(7,2),(7,12),(7,20),(8,3),(8,13),
  (9,4),(9,14),(9,5),(10,6),(10,15),(10,7),(11,8),(11,16),(11,9),(12,10),(12,17),
  (13,11),(13,18),(13,12),(14,13),(14,19),(14,1),(15,20),(15,2),(16,3),(16,14),
  (17,4),(17,15),(17,5),(18,6),(18,16),(18,7),(19,8),(19,17),(19,9),(20,10),(20,18)
ON CONFLICT DO NOTHING;

-- film_category assignments (one category per film)
INSERT INTO film_category (film_id, category_id) VALUES
  (1,6),(2,11),(3,6),(4,1),(5,9),(6,1),(7,5),(8,1),(9,11),(10,5),
  (11,7),(12,9),(13,1),(14,5),(15,11),(16,6),(17,7),(18,8),(19,6),(20,2)
ON CONFLICT DO NOTHING;

-- stores (manager_staff_id set after staff insert)
INSERT INTO store (address_id) VALUES (1),(2)
ON CONFLICT DO NOTHING;

-- staff
INSERT INTO staff (first_name, last_name, address_id, email, store_id, username) VALUES
  ('Mike','Hillyer',3,'Mike.Hillyer@sakilastaff.com',1,'Mike'),
  ('Jon','Stephens',4,'Jon.Stephens@sakilastaff.com',2,'Jon'),
  ('Sarah','Connor',5,'Sarah.Connor@sakilastaff.com',1,'Sarah'),
  ('James','Cameron',6,'James.Cameron@sakilastaff.com',2,'James')
ON CONFLICT DO NOTHING;

UPDATE store SET manager_staff_id = 1 WHERE store_id = 1;
UPDATE store SET manager_staff_id = 2 WHERE store_id = 2;

-- customers (30)
INSERT INTO customer (store_id, first_name, last_name, email, address_id) VALUES
  (1,'MARY','SMITH','MARY.SMITH@sakilacustomer.org',7),
  (1,'PATRICIA','JOHNSON','PATRICIA.JOHNSON@sakilacustomer.org',8),
  (1,'LINDA','WILLIAMS','LINDA.WILLIAMS@sakilacustomer.org',9),
  (2,'BARBARA','JONES','BARBARA.JONES@sakilacustomer.org',10),
  (2,'ELIZABETH','BROWN','ELIZABETH.BROWN@sakilacustomer.org',11),
  (2,'JENNIFER','DAVIS','JENNIFER.DAVIS@sakilacustomer.org',12),
  (1,'MARIA','MILLER','MARIA.MILLER@sakilacustomer.org',13),
  (1,'SUSAN','WILSON','SUSAN.WILSON@sakilacustomer.org',14),
  (2,'MARGARET','MOORE','MARGARET.MOORE@sakilacustomer.org',15),
  (2,'DOROTHY','TAYLOR','DOROTHY.TAYLOR@sakilacustomer.org',1),
  (1,'LISA','ANDERSON','LISA.ANDERSON@sakilacustomer.org',2),
  (1,'NANCY','THOMAS','NANCY.THOMAS@sakilacustomer.org',3),
  (2,'KAREN','JACKSON','KAREN.JACKSON@sakilacustomer.org',4),
  (2,'BETTY','WHITE','BETTY.WHITE@sakilacustomer.org',5),
  (1,'HELEN','HARRIS','HELEN.HARRIS@sakilacustomer.org',6),
  (1,'SANDRA','MARTIN','SANDRA.MARTIN@sakilacustomer.org',7),
  (2,'DONNA','GARCIA','DONNA.GARCIA@sakilacustomer.org',8),
  (2,'CAROL','MARTINEZ','CAROL.MARTINEZ@sakilacustomer.org',9),
  (1,'RUTH','ROBINSON','RUTH.ROBINSON@sakilacustomer.org',10),
  (1,'SHARON','CLARK','SHARON.CLARK@sakilacustomer.org',11),
  (2,'MICHELLE','RODRIGUEZ','MICHELLE.RODRIGUEZ@sakilacustomer.org',12),
  (2,'LAURA','LEWIS','LAURA.LEWIS@sakilacustomer.org',13),
  (1,'SARAH','LEE','SARAH.LEE@sakilacustomer.org',14),
  (1,'KIMBERLY','WALKER','KIMBERLY.WALKER@sakilacustomer.org',15),
  (2,'DEBORAH','HALL','DEBORAH.HALL@sakilacustomer.org',1),
  (2,'JESSICA','ALLEN','JESSICA.ALLEN@sakilacustomer.org',2),
  (1,'SHIRLEY','YOUNG','SHIRLEY.YOUNG@sakilacustomer.org',3),
  (1,'ANGELA','HERNANDEZ','ANGELA.HERNANDEZ@sakilacustomer.org',4),
  (2,'MELISSA','KING','MELISSA.KING@sakilacustomer.org',5),
  (2,'BRENDA','WRIGHT','BRENDA.WRIGHT@sakilacustomer.org',6)
ON CONFLICT DO NOTHING;

-- inventory: 3-4 copies per film, spread across 2 stores
INSERT INTO inventory (film_id, store_id)
SELECT f.film_id, s.store_id
FROM film f
CROSS JOIN store s
CROSS JOIN generate_series(1,2) g
ON CONFLICT DO NOTHING;

-- rentals (120): each customer rents a few films
-- Uses modulo arithmetic instead of random()*COUNT to avoid float-rounding FK violations.
INSERT INTO rental (rental_date, inventory_id, customer_id, return_date, staff_id)
SELECT
  NOW() - ((c.customer_id * 1997 + n * 1049) % 60 || ' days')::INTERVAL,
  inv.inventory_id,
  c.customer_id,
  CASE WHEN (c.customer_id * 31 + n) % 5 != 0
       THEN NOW() - ((c.customer_id * 997 + n * 503) % 30 || ' days')::INTERVAL
       ELSE NULL END,
  1 + ((c.customer_id + n) % 2)
FROM customer c
CROSS JOIN generate_series(1, 4) n
JOIN inventory inv
  ON inv.inventory_id = 1 + ((c.customer_id * 1997 + n * 1049) % (SELECT COUNT(*) FROM inventory))::INT;

-- payments: one per returned rental
INSERT INTO payment (customer_id, staff_id, rental_id, amount, payment_date)
SELECT
  r.customer_id,
  r.staff_id,
  r.rental_id,
  (0.99 + (r.rental_id % 8))::NUMERIC(5,2),
  r.return_date
FROM rental r
WHERE r.return_date IS NOT NULL;

-- Refresh row-count statistics so the galaxy view shows accurate table sizes
ANALYZE;
