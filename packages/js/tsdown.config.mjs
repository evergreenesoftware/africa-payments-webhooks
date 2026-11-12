import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    testing: 'src/testing.ts',
    express: 'src/adapters/express.ts',
    fastify: 'src/adapters/fastify.ts',
    nestjs: 'src/adapters/nestjs.ts',
    koa: 'src/adapters/koa.ts',
    web: 'src/adapters/web.ts',
    next: 'src/adapters/next.ts',
    lambda: 'src/adapters/lambda.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'neutral',
  target: 'es2022',
  clean: true,
  sourcemap: false,
});
