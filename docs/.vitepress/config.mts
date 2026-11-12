import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'africa-payments-webhooks',
  description: 'Verify and normalise payment webhooks from African providers.',
  base: '/africa-payments-webhooks/',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Providers', link: '/guide/providers' },
      { text: 'npm', link: 'https://www.npmjs.com/package/africa-payments-webhooks' },
      { text: 'PyPI', link: 'https://pypi.org/project/africa-payments-webhooks/' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'The raw-body rule', link: '/guide/raw-body' },
          { text: 'Providers', link: '/guide/providers' },
          { text: 'Duplicate events', link: '/guide/idempotency' },
          { text: 'Testing your handler', link: '/guide/testing' },
          { text: 'Security model', link: '/guide/security' },
          { text: 'Python', link: '/guide/python' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/evergreenesoftware/africa-payments-webhooks' }],
    footer: { message: 'MIT Licensed', copyright: '© 2026 Evergreene Software LTD' },
    search: { provider: 'local' },
  },
});
