import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { scratchDirectory } from "./scratch.mjs";
const exec = promisify(execFile);
export async function withDatabase(run) {
  if (process.env.DATABASE_URL) return run(process.env.DATABASE_URL);
  const shared = path.join(os.homedir(),"tmp/scoat-delivery/p01/postgres-bin");
  const bin = path.join(shared,"package/native/bin");
  const env = { ...process.env, LD_LIBRARY_PATH: path.join(shared,"package/native/lib") + ":" + path.join(shared,"icu/usr/lib/aarch64-linux-gnu") };
  const root = await scratchDirectory("database-",path.join(os.homedir(),"tmp/scoat-delivery/p04"));
  const data = path.join(root,"data");
  const socket = path.join(root,"socket");
  await mkdir(socket);
  const port = await new Promise((resolve,reject) => { const server = net.createServer(); server.on("error",reject); server.listen(0,"127.0.0.1",() => { const port = server.address().port; server.close(() => resolve(port)); }); });
  let started = false;
  try {
    await exec(path.join(bin,"initdb"),["-D",data,"-A","trust","--no-locale"],{ env });
    await exec(path.join(bin,"pg_ctl"),["-D",data,"-l",path.join(root,"postgres.log"),"-w","-t","15","-o","-h 127.0.0.1 -p " + port + " -k " + socket,"start"],{ env });
    started = true;
    return await run("postgres://" + os.userInfo().username + "@127.0.0.1:" + port + "/postgres");
  } finally {
    if (started) await exec(path.join(bin,"pg_ctl"),["-D",data,"-w","-t","15","stop","-m","fast"],{ env });
    await rm(data,{ recursive:true,force:true });
    await rm(socket,{ recursive:true,force:true });
  }
}
