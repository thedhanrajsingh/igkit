import { NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl, getMissingInstagramOAuthEnv } from "@/lib/env";
import { createOAuthState, getAuthorizationUrl } from "@/lib/meta/oauth";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.redirect(`${getBaseUrl()}/login`);
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=forbidden`);
  }

  // requireEnv throws, and a 500 on a plain <a> navigation reads to the user as
  // the button doing nothing.
  const missingEnv = getMissingInstagramOAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.redirect(
      `${getBaseUrl()}/settings?instagram=misconfigured&missing=${encodeURIComponent(
        missingEnv.join(",")
      )}`
    );
  }

  const redirectUri = `${getBaseUrl()}/api/instagram/callback`;
  const state = createOAuthState(context.workspaceId);

  return NextResponse.redirect(getAuthorizationUrl(redirectUri, state));
}
