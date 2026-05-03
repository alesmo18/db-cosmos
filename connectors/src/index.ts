export { PostgresConnector } from './postgres';
export { MySQLConnector } from './mysql';
export { SQLiteConnector } from './sqlite';
export type { DBConnector, IntrospectionResult, LiveStats } from './types';

import type { ConnectionConfig } from '@db-cosmos/shared';
import type { DBConnector } from './types';
import { PostgresConnector } from './postgres';
import { MySQLConnector } from './mysql';
import { SQLiteConnector } from './sqlite';

export function createConnector(config: ConnectionConfig): DBConnector {
  switch (config.driver) {
    case 'postgres': return new PostgresConnector(config);
    case 'mysql':    return new MySQLConnector(config);
    case 'sqlite':   return new SQLiteConnector(config);
    default: throw new Error(`Unknown driver: ${(config as ConnectionConfig).driver}`);
  }
}
