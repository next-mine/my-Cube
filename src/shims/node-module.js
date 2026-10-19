/**
 * @file node:module 的浏览器替身
 * @brief manifold 的 Emscripten 胶水代码里有一段 Node 专用分支（用 createRequire 读
 *        文件系统），浏览器构建时 Rollup 会警告「node:module 被外部化了」。
 *        我们显式提供一个同名 shim，让构建安静下来；真在浏览器里调用它会立刻报错，
 *        而不是悄悄返回 undefined——这样万一环境判断出错，也能第一时间发现。
 */

/**
 * @brief 浏览器里没有 require，调用即抛错。
 * @returns {never}
 */
export function createRequire() {
  throw new Error('浏览器环境不支持 createRequire；Cubo 用内嵌 WASM 字节码初始化，不会走到这里。');
}

export default { createRequire };
