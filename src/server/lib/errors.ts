import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

z.config(z.locales.ko());

export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const errorBody = (code: string, message: string, fields?: Record<string, string>) => ({
  error: fields ? { code, message, fields } : { code, message },
});

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw new ApiError(400, "validation_error", "입력값을 확인해 주세요.", fields);
}
