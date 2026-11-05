import { makeSecretProviderDefinitionRegistry } from "@aprende/secret-provider-core/shared/definition";
import * as OnePassword from "@aprende/secret-provider-onepassword/shared/definition";

export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  OnePassword.definition,
]);
