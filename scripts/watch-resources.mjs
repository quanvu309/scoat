export async function stopFixtureProcess(child, signal = "SIGTERM", grace = 3000) {
 if (child.exitCode !== null || child.signalCode !== null) return;
 await new Promise((resolve, reject) => {
  const timer = setTimeout(() => child.kill("SIGKILL"), grace);
  const finish = error => {
   clearTimeout(timer);
   child.removeListener("exit", exited);
   child.removeListener("error", failed);
   if (error) reject(error); else resolve();
  };
  const exited = () => finish();
  const failed = error => finish(error);
  child.once("exit", exited);
  child.once("error", failed);
  child.kill(signal);
 });
}

export async function closeWatchBrowser(server) {
 if (!server) return;
 const timer = setTimeout(() => server.process()?.kill("SIGKILL"), 5000);
 try { await server.close(); }
 finally { clearTimeout(timer); }
}
