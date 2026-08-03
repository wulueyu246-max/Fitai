const {ProductProviderError} = require("./product_provider");

/**
 * Stable service boundary for Taobao Alliance search.
 * The caller only knows the normalized Product object; credentials remain in
 * the server-side Provider implementation.
 */
class TaobaoService {
  constructor({provider}) {
    if (!provider || typeof provider.recommend !== "function") {
      throw new ProductProviderError("淘宝商品 Provider 无效", {
        status: 500,
        code: "INVALID_PRODUCT_PROVIDER",
      });
    }
    this.provider = provider;
  }

  search(filters = {}) {
    return this.provider.recommend(filters);
  }
}

module.exports = {TaobaoService};
