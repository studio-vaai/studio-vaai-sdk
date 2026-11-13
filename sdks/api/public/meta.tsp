import "./core.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace StudioVaai {
  // API availability

  @doc("The public API is available to accept requests.")
  model HealthStatus {
    status: "healthy";
  }

  @route("/health")
  @tag("meta")
  @useAuth(NoAuth)
  interface Meta {
    @get
    @operationId("getHealth")
    @summary("Check API availability")
    @doc("Check whether the public API is available to accept requests. Returns 200 when available or 503 when unavailable. No API key or session is required. Responses must not be cached.")
    getHealth():
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @body health: HealthStatus;
        }
      | NoStoreServiceUnavailableResponse;
  }
}
