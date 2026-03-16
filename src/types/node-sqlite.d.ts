declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare<Row = Record<string, unknown>>(sql: string): {
      all(...params: unknown[]): Row[];
      get(...params: unknown[]): Row | undefined;
      run(...params: unknown[]): {
        changes: number;
        lastInsertRowid: bigint | number;
      };
    };
  }
}