import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

/**
 * Hostnames allowed to reach the dev server. Vite rejects anything else by
 * default, which is what a reverse-proxied domain runs into.
 */
const allowedHosts = (process.env.DEV_ALLOWED_HOSTS ?? "dev.erkut.dev")
	.split(",")
	.map((host) => host.trim())
	.filter(Boolean);

/**
 * Behind a TLS tunnel the HMR client would otherwise dial wss://<host>:5173,
 * which the proxy does not expose. Point it at the public port instead.
 */
const tunnelHost = process.env.DEV_TUNNEL_HOST;

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		allowedHosts,
		hmr: tunnelHost ? { protocol: "wss", host: tunnelHost, clientPort: 443 } : undefined
	}
});
