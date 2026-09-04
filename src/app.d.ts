import type { Session, User } from "$lib/server/auth";

declare global {
	namespace App {
		interface Error {
			message: string;
		}
		interface Locals {
			session: Session | null;
			user: User | null;
		}
	}
}

export {};
