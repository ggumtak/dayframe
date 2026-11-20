import { createHandler } from "./handler.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("DAYFRAME_SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
if (!url || !key) throw new Error("Supabase URL and publishable/anon key are required");
Deno.serve(createHandler({ url, key }));
