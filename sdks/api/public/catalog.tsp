import "./core.tsp";
import "./diagnostics.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace StudioVaai {
  // Product catalog

  @doc("A product of your shop.")
  model ProductSummary {
    productId: string;
  }

  @doc("The products of your shop that can be tried on.")
  model ProductCatalog {
    products: ProductSummary[];
  }

  @doc("One sellable combination of a product. Pass its `id` to `createTryOn`.")
  model ProductVariant {
    id: string;

    @doc("This variant's value on every axis the product is sold by, in your shop's own ids: for example `{ colorway: \"A100-259\", size: \"XS\" }`. Keys are `colorway` and `size`, plus any further axis of the product. Use them to match the variant to your storefront's selection and to add it to the cart.")
    @example(#{ colorway: "A100-259", size: "XS" })
    foreignVariantIds: Record<string>;

    @doc("Your shop's own id for this combination, such as its variant id or SKU, when the product names one. Use it to add the variant to the cart directly.")
    @example("44718293")
    foreignId?: string;
  }

  @doc("What the API knows about a product: its variants. Names, prices, photos, labels and ordering stay with your storefront.")
  model ProductDetails {
    productId: string;

    @doc("Every variant that can be tried on.")
    variants: ProductVariant[];

    @doc("Diagnostic metadata for internal tooling.")
    @extension("x-internal", true)
    provenance?: ListingProvenance;
  }

  @doc("Your shop has no such product.")
  model ProductNotFoundResponse {
    @statusCode _: 404;
    @body problem: ProblemDetails;
  }

  @tag("catalog")
  interface Catalog {
    @get
    @route("/products")
    @operationId("listProducts")
    @summary("List products")
    @useAuth(NoAuth)
    @doc("List the products of your shop that can be tried on. Requires the shop client API key; no shopper session is needed.")
    listProducts(...ApiVersionHeader, ...ClientApiKeyHeader):
      | ProductCatalog
      | ProblemDetailsResponse
      | InternalServerErrorResponse;

    @get
    @route("/products/by-foreign-id/{foreignId}")
    @operationId("getProductByForeignId")
    @summary("Find a product by your own id")
    @useAuth(NoAuth)
    @doc("Retrieve a product by the id your storefront uses for it. A `product-not-found` error means the product cannot be tried on, so hide the try-on entry point. Requires the shop client API key; no shopper session is needed.")
    getProductByForeignId(
      ...ApiVersionHeader,
      ...ClientApiKeyHeader,
      @path foreignId: string,

      @doc("Optional diagnostic fields for internal tooling.")
      @extension("x-internal", true)
      @query
      include?: string,
    ):
      | ProductDetails
      | ProblemDetailsResponse
      | ProductNotFoundResponse
      | InternalServerErrorResponse;

    @get
    @route("/products/{productId}")
    @operationId("getProductDetails")
    @summary("Get product details")
    @useAuth(NoAuth)
    @doc("Retrieve a product's variants and fit details. Requires the shop client API key; no shopper session is needed. Products outside your shop return a `product-not-found` error.")
    getProductDetails(
      ...ApiVersionHeader,
      ...ClientApiKeyHeader,
      @path productId: string,

      @doc("Optional diagnostic fields for internal tooling.")
      @extension("x-internal", true)
      @query
      include?: string,
    ):
      | ProductDetails
      | ProblemDetailsResponse
      | ProductNotFoundResponse
      | InternalServerErrorResponse;
  }
}
