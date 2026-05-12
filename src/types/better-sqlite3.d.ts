declare module 'better-sqlite3' {
  interface RunResult {
    changes: number
    lastInsertRowid: number | bigint
  }

  interface Statement<BindParameters extends unknown[] = unknown[], Result = unknown> {
    run(...params: BindParameters | [Record<string, unknown>]): RunResult
    get(...params: BindParameters | [Record<string, unknown>]): Result | undefined
    all(...params: BindParameters | [Record<string, unknown>]): Result[]
  }

  class Database {
    constructor(filename: string)
    pragma(source: string): void
    exec(source: string): void
    prepare<Result = unknown>(source: string): Statement<any[], Result>
  }

  namespace Database {
    export type Database = InstanceType<typeof Database>
  }

  export default Database
}
