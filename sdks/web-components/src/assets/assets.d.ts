/** Vite's `?url` imports: the bundler hands back the asset's URL. */
declare module "*.webp?url" {
  const url: string;
  export default url;
}
