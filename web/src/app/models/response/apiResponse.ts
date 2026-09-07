/**
 * The envelope every command answers with — success or failure alike — per
 * `.claude/rules/api-response-format.md`. Mirrors
 * `src-tauri/src/models/response/api_response.rs`'s `ApiResponse<T>`.
 *
 * Nothing outside `core/zone-wrapper/zone-wrapper.service.ts` should ever see
 * this shape: `ZoneWrapperService.invoke()` unwraps `data` on a 2xx
 * `statusCode` and throws on anything else, so every other service and
 * component keeps seeing a plain `Promise<T>` that rejects the way it always
 * did.
 */
export interface ApiResponse<T> {
  statusCode: number;
  message: string;
  data: T | null;
}
