/** @type {import('next').NextConfig} */
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:55321').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',   // small self-contained server for the Docker image (deploy/)
  // files the PDF routes read at run time, so the standalone build carries them
  outputFileTracingIncludes: {
    '/api/pdf/**': ['./node_modules/@expo-google-fonts/poppins/400Regular/*.ttf', './node_modules/@expo-google-fonts/poppins/600SemiBold/*.ttf', './public/brand/stint-logo.svg'],
    '/api/portal/receipt/**': ['./node_modules/@expo-google-fonts/poppins/400Regular/*.ttf', './node_modules/@expo-google-fonts/poppins/600SemiBold/*.ttf', './public/brand/stint-logo.svg'],
  },
  // The browser never talks to Supabase directly. It calls /supabase/... on this app,
  // and the app passes the call on. That way only one address has to be reachable from the browser.
  async rewrites() {
    return [{ source: '/supabase/:path*', destination: `${supabaseUrl}/:path*` }];
  },
};
export default nextConfig;
