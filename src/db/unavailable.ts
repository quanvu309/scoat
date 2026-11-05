import pg from "pg";

export class DatabaseUnavailable extends Error {
  constructor() { super("Database temporarily unavailable"); }
}

export function databaseUnavailable(error: unknown): DatabaseUnavailable | null {
  if (error instanceof DatabaseUnavailable) return error;
  if (error instanceof pg.DatabaseError && (error.code?.startsWith("08") || ["53000", "53100", "53200", "53300", "53400", "55P03", "57014", "57P01", "57P02", "57P03", "58000", "58030"].includes(error.code ?? ""))) return new DatabaseUnavailable();
  if (error instanceof Error && "code" in error && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENETUNREACH", "EHOSTUNREACH"].includes(String(error.code))) return new DatabaseUnavailable();
  if (error instanceof Error && ["Connection terminated unexpectedly", "Connection terminated", "Connection terminated due to connection timeout", "timeout exceeded when trying to connect"].includes(error.message)) return new DatabaseUnavailable();
  return null;
}
