import { validateEnv } from "./src/lib/env";

// Validate environment variables at build/startup time
validateEnv();

/**
 * Source maps production policy (issue #860):
 *
 * - Production builds MUST NOT ship browser-readable source maps. Serving
 *   `.map` files exposes original TypeScript, internal module paths, and
 *   any inlined constants to anyone with devtools, which is a security and
 *   IP-leak risk on the money path (wallet / AA / payment flows).
 * - Development and test builds keep source maps enabled so contributors
 *   (including Stellar Wave) can debug with real stack traces.
 *
 * The value below is derived from NODE_ENV so the policy is fail-closed:
 * any non-`development`/`test` environment (including `production` and
 * unknown values) resolves to `false`. See docs/security-ux-guards.md and
 * tests/ci-workflow.test.ts for the enforced invariant.
 */
const isDevOrTest =
	process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

/** @type {import('next').NextConfig} */
const nextConfig = {
	/**
	 * Compress responses with gzip / brotli.
	 * Reduces transfer size for the analytics bundle and other large pages.
	 */
	compress: true,

	/**
	 * Source maps production policy: enabled only in dev/test, disabled
	 * (fail-closed) everywhere else so production never ships readable
	 * source maps. Do not hardcode `true` here.
	 */
	productionBrowserSourceMaps: isDevOrTest,

	/**
	 * Enable granular code-splitting for large client bundles (Next 13+).
	 * This tells the router to prepare client chunks incrementally rather
	 * than all at once, which helps the analytics page load faster.
	 */
	experimental: {
		optimizePackageImports: [
			"@/components/analytics",
			"@/components/dashboard",
		],
	},

	/**
	 * The dev-mode build indicator overlay renders a full-viewport portal
	 * that intercepts pointer events, which blocks Playwright (and manual
	 * QA) from clicking through the app in `next dev`. Disabling it only
	 * affects local development UI, not production behavior.
	 */
	devIndicators: false,
};

export default nextConfig;
