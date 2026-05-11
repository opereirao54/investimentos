/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Permite carregar o HTML legado como raw HTML
  experimental: {
    serverComponentsExternalPackages: ['firebase-admin']
  },
  // Headers de segurança para o iframe/HTML injetado
  async headers() {
    return [
      {
        source: '/dashboard',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          }
        ]
      }
    ]
  }
}

module.exports = nextConfig
