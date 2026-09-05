import { eq } from 'drizzle-orm';
import { loadConfig, loadEnvFile } from '../config/configuration';
import { createConnection, type Connection } from './client';
import { customers, products } from './schema';

/**
 * FR-017a. Spec 002 owns `customers` and `products` as placeholders whose
 * contract states only their `id` columns survive, so no endpoint writes them.
 * This is how usable identifiers come to exist.
 *
 * Deliberately not a data migration. Migration rows would land in every
 * database including the test one, which breaks the requirement that a test
 * observes only the rows it created.
 */
const SEED_CUSTOMERS = ['Acme Corporation', 'Blue Ridge Supply'] as const;

const SEED_PRODUCTS = [
  { name: 'Widget', unitPriceMinor: 1299 },
  { name: 'Gadget', unitPriceMinor: 4550 },
  { name: 'Sprocket', unitPriceMinor: 99 },
] as const;

export interface SeedResult {
  customerIds: number[];
  productIds: number[];
}

/** Re-runnable: matches on name, so a second run neither duplicates nor fails. */
export function seed(connection: Connection): SeedResult {
  const customerIds = SEED_CUSTOMERS.map((name) => {
    const [existing] = connection.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.name, name))
      .all();
    if (existing) {
      return existing.id;
    }
    const [created] = connection.db
      .insert(customers)
      .values({ name })
      .returning({ id: customers.id })
      .all();
    return created!.id;
  });

  const productIds = SEED_PRODUCTS.map((product) => {
    const [existing] = connection.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.name, product.name))
      .all();
    if (existing) {
      return existing.id;
    }
    const [created] = connection.db
      .insert(products)
      .values(product)
      .returning({ id: products.id })
      .all();
    return created!.id;
  });

  return { customerIds, productIds };
}

function main(): void {
  loadEnvFile();
  const config = loadConfig();
  const connection = createConnection(config.DATABASE_PATH);

  try {
    const { customerIds, productIds } = seed(connection);

    process.stdout.write(`Seeded ${config.DATABASE_PATH}\n`);
    process.stdout.write(`  customers: ${customerIds.join(', ')}\n`);
    process.stdout.write(`  products : ${productIds.join(', ')}\n`);
    process.stdout.write('\nPlace an order:\n');
    process.stdout.write(
      `  curl -sS -X POST localhost:${config.PORT}/api/v1/orders -H 'content-type: application/json' \\\n` +
        `    -d '{"customerId":${customerIds[0]},"lines":[{"productId":${productIds[0]},"quantity":3}]}'\n`,
    );
  } finally {
    connection.close();
  }
}

if (require.main === module) {
  main();
}
