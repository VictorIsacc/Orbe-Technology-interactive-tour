(() => {
  "use strict";

  /*
   * Configuración local y explícita por calle o tramo.
   * No existe una regla universal de numeración: cada entrada debe verificarse.
   *
   * lowEnd / highEnd: extremos aproximados del eje del tramo, desde números bajos
   * hacia números altos.
   * lowNumbersLeadToCenter: true si avanzar hacia lowEnd conduce al centro;
   * false si conduce al centro avanzar hacia highEnd; null si no se conoce.
   * oddSideWhenIncreasing: lado de los impares al avanzar de lowEnd a highEnd.
   */
  window.ORBE_STREET_NUMBERING_CONFIG = [
    {
      id: "gran-via-tramo-piloto",
      name: "Gran Vía de Colón · tramo piloto",
      enabled: true,
      status: "experimental-local",
      lowEnd: { lat: 37.17610, lon: -3.59805 },
      highEnd: { lat: 37.18235, lon: -3.60115 },
      lowNumbersLeadToCenter: true,
      oddSideWhenIncreasing: "left",
      maxDistanceMeters: 45,
      maxAccuracyMeters: 18,
      maxHeadingErrorDegrees: 55,
      note: "Configuración piloto local. Debe verificarse la numeración real antes de usarla como referencia práctica."
    }
  ];
})();
