import { json, withAuth } from "@/lib/auth/authorize";

export const GET = withAuth(undefined, (_request, user) => json({ user }));
