import { readMw05LocalConfig, writeAdminLocalEnv, writeMiniprogramLocalCloud, writeMiniprogramPrivateConfig } from "./mw05-lib.mjs";

writeAdminLocalEnv();
writeMiniprogramLocalCloud();
writeMiniprogramPrivateConfig();
const local = readMw05LocalConfig();
const whitelist = Boolean(local.allowedMiniAppIds && !/placeholder/i.test(local.allowedMiniAppIds));
const resource = Boolean(local.resourceAppId && !/placeholder/i.test(local.resourceAppId));
console.log(
  JSON.stringify(
    {
      adminEnvWritten: true,
      privateConfigWritten: true,
      cloudLocalWritten: true,
      cloudRuntimeWritten: true,
      mwAppIdConfigured: whitelist,
      resourceAppIdConfigured: resource
    },
    null,
    2
  )
);
