import { useEnvironments } from "~/state/environments";
import { isProviderSettingsEnvironmentAvailable } from "./ProviderSettingsPanel.logic";
import { filterAvailableSettingsSearchItems } from "./settingsSearch";

export function useAvailableSettingsSearchItems() {
  const { environments } = useEnvironments();
  // An explicit boolean keeps the flag out of the filter cache so environment updates do not rebuild the list.
  const hasProviderSettingsEnvironment =
    environments.some((environment) =>
      isProviderSettingsEnvironmentAvailable({
        connectionPhase: environment.connection.phase,
        hasServerConfig: environment.serverConfig !== null,
      }),
    ) === true;

  return filterAvailableSettingsSearchItems({ hasProviderSettingsEnvironment });
}
