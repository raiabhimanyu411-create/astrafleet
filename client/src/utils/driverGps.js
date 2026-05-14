const GPS_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 10000,
  timeout: 15000
};

export function gpsErrorMessage(error) {
  if (!navigator.geolocation) {
    return "GPS is not supported in this browser. Driver login requires location access.";
  }

  if (error?.code === 1) {
    return "GPS permission denied. Please allow location access to use the driver panel.";
  }

  if (error?.code === 2) {
    return "GPS is unavailable. Please turn on device location services and try again.";
  }

  if (error?.code === 3) {
    return "GPS request timed out. Please check location services and try again.";
  }

  return "GPS access is required for driver tracking.";
}

export function requestDriverGpsAccess() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error(gpsErrorMessage()));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, GPS_OPTIONS);
  });
}

export function watchDriverGps({ onPosition, onBlocked }) {
  if (!navigator.geolocation) {
    onBlocked?.(new Error(gpsErrorMessage()));
    return () => {};
  }

  let stopped = false;

  function handleError(error) {
    if (stopped) return;

    if (error?.code === 1 || error?.code === 2) {
      onBlocked?.(error);
    }
  }

  function checkPermissionState() {
    if (!navigator.permissions?.query) return;

    navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (permission.state === "denied") {
          onBlocked?.({ code: 1 });
        }
        permission.onchange = () => {
          if (permission.state === "denied") {
            onBlocked?.({ code: 1 });
          }
        };
      })
      .catch(() => {});
  }

  const watchId = navigator.geolocation.watchPosition(onPosition, handleError, GPS_OPTIONS);
  const heartbeat = window.setInterval(() => {
    navigator.geolocation.getCurrentPosition(onPosition, handleError, GPS_OPTIONS);
    checkPermissionState();
  }, 20000);

  window.addEventListener("focus", checkPermissionState);
  document.addEventListener("visibilitychange", checkPermissionState);
  checkPermissionState();

  return () => {
    stopped = true;
    navigator.geolocation.clearWatch(watchId);
    window.clearInterval(heartbeat);
    window.removeEventListener("focus", checkPermissionState);
    document.removeEventListener("visibilitychange", checkPermissionState);
  };
}

export function positionToPayload(position) {
  const { latitude, longitude, accuracy, speed } = position.coords;

  return {
    latitude,
    longitude,
    accuracy,
    speedKph: speed == null ? null : Math.max(0, speed * 3.6)
  };
}
