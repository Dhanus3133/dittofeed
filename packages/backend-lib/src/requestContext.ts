import { err, ok, Result } from "neverthrow";

import { decodeJwtHeader } from "./auth";
import config from "./config";
import prisma from "./prisma";
import { DFRequestContext } from "./types";

export enum RequestContextErrorType {
  Unauthorized = "Unauthorized",
  NotOnboarded = "NotOnboarded",
  EmailNotVerified = "EmailNotVerified",
  ApplicationError = "ApplicationError",
}

export interface UnauthorizedError {
  type: RequestContextErrorType.Unauthorized;
  message: string;
}

export interface NotOnboardedError {
  type: RequestContextErrorType.NotOnboarded;
  message: string;
}

export interface ApplicationError {
  type: RequestContextErrorType.ApplicationError;
  message: string;
}

export interface EmailNotVerifiedError {
  type: RequestContextErrorType.EmailNotVerified;
}

export type RequestContextError =
  | UnauthorizedError
  | NotOnboardedError
  | ApplicationError
  | EmailNotVerifiedError;

export async function getRequestContext(
  authorizationToken: string | null
): Promise<Result<DFRequestContext, RequestContextError>> {
  if (config().authMode === "anonymous") {
    const workspaceId = config().defaultWorkspaceId;

    const workspace = await prisma().workspace.findUnique({
      where: {
        id: workspaceId,
      },
    });
    if (!workspace) {
      throw new Error("Misconfigured default workspace, missing.");
    }
    return ok({
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
      member: {
        id: "anonymous",
        email: "anonymous@email.com",
        emailVerified: true,
      },
      memberRoles: [
        {
          workspaceId: workspace.id,
          workspaceMemberId: "anonymous",
          role: "Admin",
        },
      ],
    });
  }

  const { authProvider } = config();

  if (!authProvider) {
    throw new Error("Misconfigured auth provider, missing.");
  }

  const decodedJwt = authorizationToken
    ? decodeJwtHeader(authorizationToken)
    : null;

  if (!decodedJwt) {
    return err({
      type: RequestContextErrorType.Unauthorized,
      message: "Unable to decode jwt",
    });
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { sub, email, picture, email_verified } = decodedJwt;

  if (!email_verified) {
    return err({
      type: RequestContextErrorType.EmailNotVerified,
    });
  }

  // eslint-disable-next-line prefer-const
  let [member, account] = await Promise.all([
    prisma().workspaceMember.findUnique({
      where: { email },
      include: {
        WorkspaceMemberRole: {
          take: 1,
          include: {
            workspace: true,
          },
        },
      },
    }),
    prisma().workspaceMembeAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: authProvider,
          providerAccountId: sub,
        },
      },
    }),
  ]);

  if (
    !member ||
    member.emailVerified !== email_verified ||
    member.image !== picture
  ) {
    member = await prisma().workspaceMember.upsert({
      where: { email },
      create: {
        email,
        emailVerified: email_verified,
        image: picture,
      },
      include: {
        WorkspaceMemberRole: {
          take: 1,
          include: {
            workspace: true,
          },
        },
      },
      update: {
        emailVerified: email_verified,
        image: picture,
      },
    });
  }

  if (!account) {
    await prisma().workspaceMembeAccount.upsert({
      where: {
        provider_providerAccountId: {
          provider: authProvider,
          providerAccountId: sub,
        },
      },
      create: {
        provider: authProvider,
        providerAccountId: sub,
        workspaceMemberId: member.id,
      },
      update: {},
    });
  }

  // TODO allow users to switch between workspaces
  const role = member.WorkspaceMemberRole[0];

  if (!role) {
    return err({
      type: RequestContextErrorType.NotOnboarded,
      message: "User missing role",
    });
  }

  if (!member.email) {
    return err({
      type: RequestContextErrorType.ApplicationError,
      message: "User missing email",
    });
  }

  return ok({
    member: {
      id: member.id,
      email: member.email,
      emailVerified: member.emailVerified,
    },
    workspace: {
      id: role.workspace.id,
      name: role.workspace.name,
    },
    memberRoles: [
      {
        workspaceId: role.workspace.id,
        role: role.role,
        workspaceMemberId: member.id,
      },
    ],
  });
}