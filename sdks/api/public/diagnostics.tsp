// Diagnostic metadata retained for SDK tooling. Excluded from customer-facing documentation
// and downloadable specifications via x-internal on models, fields, and parameters.
using TypeSpec.OpenAPI;

namespace StudioVaai {
  @doc("Where a try-on came from, so a reviewer can trace the image back to the exact bake and builds that produced it. Hashes and ids only, never who did anything. Not the C2PA manifest (that is in the image).")
  @extension("x-internal", true)
  model TryOnProvenance {
    @doc("The body the garment was draped on.")
    bodyId: string;

    productId: string;

    @doc("The catalog piece (one size of one style) that was rendered.")
    pieceId: string;

    @doc("Storefront size slug of that piece (`27-l30`, `s`).")
    sizeSlug: string;

    @doc("blake3 (hex) of the publication manifest the piece pointed at when the try-on ran. Absent for pieces without a native publication.")
    manifestHash?: string;

    @doc("The publication's size (realization) id the piece selects, decimal.")
    realizationId?: string;

    @doc("blake3 (hex) of the stored drape (the publication's executable drape object) the render used.")
    bakeHash?: string;

    @doc("Deployment environment that served the try-on (`int`, `prod`, `dev`).")
    environment?: string;

    @doc("API server build (image tag, a commit) that ran the try-on.")
    apiBuild?: string;

    @doc("Inference build (image tag, a commit) that rendered the image, when the renderer reported it.")
    inferenceBuild?: string;

    @doc("RFC 3339.")
    createdAt: string;

    @doc("RFC 3339.")
    resolvedAt?: string;
  }

  @doc("One size of a listing's provenance: the catalog piece and the stored drape it renders.")
  @extension("x-internal", true)
  model ListingSizeProvenance {
    @doc("Storefront size slug (`27-l30`, `s`).")
    sizeSlug: string;

    @doc("Style slug of the piece's template.")
    templateSlug: string;

    pieceId: string;

    @doc("blake3 (hex) of the publication manifest the piece points at. Equals `ListingProvenance.manifestHash` once the promotion reached every size.")
    manifestHash?: string;

    @doc("The publication's size (realization) id the piece selects, decimal.")
    realizationId?: string;

    @doc("blake3 (hex) of the stored drape (the publication's executable drape object) this size renders. Absent when the manifest could not be read.")
    bakeHash?: string;
  }

  @doc("The library binding of one template (style) of a listing: a product with several templates binds each to its own library garment and promotes each on its own.")
  @extension("x-internal", true)
  model ListingTemplateProvenance {
    @doc("Style slug of the template (`ListingSizeProvenance.templateSlug`).")
    templateSlug: string;

    templateId: string;

    @doc("The catalog binding that sells the library garment as this template.")
    bindingId: string;

    @doc("Library garment slug.")
    garmentSlug: string;

    @doc("Number of the promoted library revision (`5` reads `r5`). Absent before the template's first promotion.")
    revisionNumber?: int32;

    revisionId?: string;

    @doc("First line of the promoted revision's commit message, at most 120 characters.")
    revisionMessage?: string;

    @doc("blake3 (hex) of the template's promoted publication manifest: what its sizes' `manifestHash` equal once the promotion reached every size.")
    manifestHash?: string;

    @doc("Content hash (hex) of the listing the promotion applied.")
    listingHash?: string;

    @doc("RFC 3339.")
    promotedAt?: string;
  }

  @doc("Where a listing came from, so a reviewer can check the shop serves exactly what Studio pushed and promoted: the library garment and revision, the publication, and the stored drape per size. Hashes, ids and timestamps only, never who pushed or promoted.")
  @extension("x-internal", true)
  model ListingProvenance {
    productId: string;

    @doc("The catalog template the library garment sells as. Absent when no library binding sells the product (git-seeded fixtures). With several bound templates, this and the binding, garment and revision fields below are the first template's (by slug); `templates` has each one's.")
    templateId?: string;

    @doc("The catalog binding that sells the library garment in this shop.")
    bindingId?: string;

    @doc("Library garment slug.")
    garmentSlug?: string;

    @doc("Number of the promoted library revision (`5` reads `r5`).")
    revisionNumber?: int32;

    revisionId?: string;

    @doc("First line of the promoted revision's commit message, at most 120 characters.")
    revisionMessage?: string;

    @doc("blake3 (hex) of the promoted publication manifest.")
    manifestHash?: string;

    @doc("Content hash (hex) of the listing the promotion applied.")
    listingHash?: string;

    @doc("RFC 3339.")
    promotedAt?: string;

    @doc("Deployment environment that served the listing (`int`, `prod`, `dev`).")
    environment?: string;

    @doc("API server build (image tag, a commit) that served the listing.")
    apiBuild?: string;

    @doc("Every published size, by rank.")
    sizes: ListingSizeProvenance[];

    @doc("Every bound template's binding, garment and promoted revision, by template slug. A size belongs to the template its `templateSlug` names. Absent when no library binding sells the product.")
    templates?: ListingTemplateProvenance[];
  }
}
