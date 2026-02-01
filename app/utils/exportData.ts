import { HotTableRef } from "@handsontable/react-wrapper";

import html2canvas from 'html2canvas-pro';

import { jsPDF } from "jspdf";

export const saveToPDF = (element: HTMLElement, fileName: string) => {
    
    const pdf = new jsPDF({
            orientation: 'l',
            unit: 'px',
            format: 'a4',
            hotfixes: ['px_scaling'],
            compress: true
        });
            html2canvas(element, {
            width: pdf.internal.pageSize.getWidth(),
            height: pdf.internal.pageSize.getHeight()
        }).then((canvas) => {
            const img = canvas.toDataURL("image/png");
            pdf.addImage(img, "PNG", 10, 10, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());            
            pdf.save(`${fileName}.pdf`);
        })
}

export const saveToCSV = (table: HotTableRef, fileName: string) => {

    const exportPlugin = table?.hotInstance?.getPlugin('exportFile');
    exportPlugin?.downloadFile('csv', {
        bom: false,
        columnDelimiter: ',',
        columnHeaders: false,
        exportHiddenColumns: true,
        exportHiddenRows: true,
        fileExtension: 'csv',
        filename: fileName,
        mimeType: 'text/csv',
        rowDelimiter: '\r\n',
        rowHeaders: true,
    });

}