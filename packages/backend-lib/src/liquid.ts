/* eslint-disable no-underscore-dangle */
import { SUBSCRIPTION_SECRET_NAME } from "isomorphic-lib/src/constants";
import { Liquid } from "liquidjs";
import MarkdownIt from "markdown-it";

import { generateSubscriptionChangeUrl } from "./subscriptionGroups";
import { SubscriptionChange } from "./types";

const md = new MarkdownIt({
  html: true,
  breaks: true,
});

const baseEmailLayout = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style type="text/css">{% block style %}{% endblock %}</style>
</head>
<body>{% block content %}{% endblock %}</body>
</html>`;

const markdownEmailLayout = `{% layout 'base-email' %}{% block content %}{% capture md %}{% block md-content %}{% endblock %}{% endcapture %}{{ md | markdown }}{% endblock %}`;

const layouts: Record<string, string> = {
  "base-email": baseEmailLayout,
  "markdown-email": markdownEmailLayout,
};

function getLayout(layoutName: string): string | undefined {
  return layouts[layoutName];
}

function getLayoutUnsafe(layoutName: string): string {
  const layout = getLayout(layoutName);
  if (layout) {
    return layout;
  }
  throw new Error(`Template not found: ${layoutName}`);
}

export const liquidEngine = new Liquid({
  strictVariables: true,
  lenientIf: true,
  relativeReference: false,
  fs: {
    readFileSync(file) {
      return getLayoutUnsafe(file);
    },
    async readFile(file) {
      return getLayoutUnsafe(file);
    },
    existsSync(file) {
      return getLayout(file) !== undefined;
    },
    async exists(file) {
      return getLayout(file) !== undefined;
    },
    contains(_root, file) {
      return getLayout(file) !== undefined;
    },
    resolve(_root, file) {
      return file;
    },
  },
});

liquidEngine.registerFilter("markdown", (value) => md.render(value));

type Secrets = Record<string, string>;
type UserProperties = Record<string, string>;

liquidEngine.registerTag("unsubscribe", {
  parse() {},
  // parse(tagToken, remainTokens) {
  //   this.str = tagToken.args; // This is your immediate argument
  // },
  async render(scope) {
    const scopedProperties = Array.from(
      scope._get([
        "secrets",
        "workspace_id",
        "subscription_group_id",
        "user",
        "identifier_key",
      ])
    );

    const [
      secrets,
      workspaceId,
      subscriptionGroupId,
      userProperties,
      identifierKey,
    ] = scopedProperties as [
      Secrets | undefined,
      string,
      string | undefined,
      UserProperties,
      string
    ];

    let href = "";

    const identifier = userProperties[identifierKey];
    const userId = userProperties.id;
    const subscriptionSecret = secrets?.[SUBSCRIPTION_SECRET_NAME];
    if (subscriptionSecret && identifier && userId) {
      const url = generateSubscriptionChangeUrl({
        workspaceId,
        identifier,
        identifierKey,
        subscriptionSecret,
        userId,
        changedSubscription: subscriptionGroupId,
        subscriptionChange: SubscriptionChange.UnSubscribe,
      });
      href = `href="${url}"`;
    }

    return `<a class="df-unsubscribe" ${href}>Unsubscribe</a>`;
  },
});

export function renderLiquid({
  template,
  userProperties,
  workspaceId,
  subscriptionGroupId,
  identifierKey,
  secrets = {},
}: {
  template: string;
  identifierKey: string;
  userProperties: UserProperties;
  secrets?: Secrets;
  subscriptionGroupId?: string;
  workspaceId: string;
}): string {
  return liquidEngine.parseAndRenderSync(template, {
    user: userProperties,
    workspace_id: workspaceId,
    subscription_group_id: subscriptionGroupId,
    secrets,
    identifier_key: identifierKey,
  });
}
