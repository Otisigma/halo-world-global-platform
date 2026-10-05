(function (global) {
  "use strict";

  function connect(context, monitorBus, isolation) {
    const highPass = context.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 30;
    // Web Audio high-pass Q is in dB; -3 dB gives a non-resonant Butterworth response.
    highPass.Q.value = -3;

    const hum50 = context.createBiquadFilter();
    hum50.type = "notch";
    hum50.frequency.value = 50;
    hum50.Q.value = 30;

    const hum60 = context.createBiquadFilter();
    hum60.type = "notch";
    hum60.frequency.value = 60;
    hum60.Q.value = 30;

    for (const filter of [highPass, hum50, hum60]) isolation.monitorOnly(filter);
    monitorBus.connect(highPass);
    highPass.connect(hum50);
    hum50.connect(hum60);
    hum60.connect(context.destination);

    return Object.freeze({ highPass, hum50, hum60 });
  }

  global.HaloDeskNoiseCleaner = Object.freeze({ connect });
})(typeof window !== "undefined" ? window : globalThis);
