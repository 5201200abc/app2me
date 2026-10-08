import { createUuid } from "@mycode/shared";

export type ConversationSourceNameResolver = (key: string) => string;
const resolvers = new WeakMap<object, ConversationSourceNameResolver>();

export function getConversationSourceNameResolver(owner: object): ConversationSourceNameResolver {
  let resolver = resolvers.get(owner);
  if (!resolver) {
    const names = new Map<string, string>();
    resolver = (key) => {
      let name = names.get(key);
      if (!name) {
        name = `image-${createUuid()}`;
        names.set(key, name);
      }
      return name;
    };
    resolvers.set(owner, resolver);
  }
  return resolver;
}
