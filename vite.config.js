import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Cubo 的 Vite 配置。
 *
 * base 用相对路径：普通构建产物放到任何静态服务器子目录下都能跑；
 * assetsInlineLimit 设为 0，是为了让 singlefile 脚本能确定地找到所有资源文件，
 * 不出现“有的图内联了、有的没内联”的半吊子情况。
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // manifold 的胶水代码引用了 Node 的 createRequire，浏览器里用不到，
      // 换成自己的 shim，构建时就不会再报“模块被外部化”的警告。
      'node:module': fileURLToPath(new URL('./src/shims/node-module.js', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
  },
});
