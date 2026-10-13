/* Offline cache, so the board keeps working with nothing else switched on.
   Browsers only allow a service worker on https:// or localhost — over the
   plain http the laptop serves, this silently does nothing, which is fine.

   Network first: a reachable server always wins, so an update is never more
   than a refresh away. The cache is only the fallback for being offline. */
var VERSION="hallpass-23";
var FILES=["./","./index.html","./styles.css","./seed-classes.js","./app.js",
           "./manifest.json","./icon-192.png","./icon-512.png"];

self.addEventListener("install",function(e){
  e.waitUntil(
    caches.open(VERSION)
      .then(function(c){return c.addAll(FILES)})
      .then(function(){return self.skipWaiting()})
  );
});

self.addEventListener("activate",function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        return k===VERSION?null:caches.delete(k);   /* old versions go */
      }));
    }).then(function(){return self.clients.claim()})
  );
});

self.addEventListener("fetch",function(e){
  if(e.request.method!=="GET")return;
  if(new URL(e.request.url).origin!==self.location.origin)return;
  e.respondWith(
    fetch(e.request).then(function(res){
      if(res&&res.ok){
        var copy=res.clone();
        caches.open(VERSION).then(function(c){c.put(e.request,copy)}).catch(function(){});
      }
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(hit){
        return hit||caches.match("./index.html");
      });
    })
  );
});
