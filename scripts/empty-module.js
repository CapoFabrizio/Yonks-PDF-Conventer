// Stub vide : remplace les imports dynamiques optionnels de jsPDF (html2canvas, dompurify,
// canvg) que nous n'utilisons jamais (jsPDF ne s'en sert que pour html(), fonctionnalité que
// nous n'appelons pas ; notre propre peintre produit directement le PDF vectoriel).
export default {};
