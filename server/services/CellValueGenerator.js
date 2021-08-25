/**
 * CellValueGenerator module - see {@tutorial CellValueGenerator-tutorial}
 * @module CellValueGenerator
 */

const moment  = require('moment')
const { validateArgs } = require('../util/ArgsValidator')
  
// @ts-check
  
  
/**
 * Class to create cellValueGenerator object
 */
class CellValueGenerator {
  /**
   * Create cellValueGenerator 
   * @param {DocText} docText - Doc text
   * @param {WordList} wordList - Sorted word list
   * @param {Object} recurringDoc - Mongoose Doc model instance (recurring document)
   * @param {string} dateToday - Today's date 
   */
  constructor (docText, wordList, recurringDoc, dateToday) {
    validateArgs([
      '{fileName: String, extraction: Array}',
      '{fileName: String, words: [Array]}', 
      '{_id: Object, name: String, idPhrase: String, header: Array, dataRows: Array, user: Object, ...}', 
      'String'
    ], arguments)
    this.docText = docText
    this.wordList = wordList
    this.recurringDoc = recurringDoc
    this.dateToday = dateToday
  }
  

  /**
   * Determines how much space must exist between two words to define a phrase break
   * @param {AnnotateImageResponseWord} currentWord - word from sorted word list  
   * @param {AnnotateImageResponseWord} nextWord - immediate next word from sorted word list
   * @returns {boolean} - true if phrase break requirement is met, false otherwise
   */
  isPhraseBreak(currentWord, nextWord) {
    validateArgs(['{symbols: Array, boundingBox: Object, confidence: Number, ...}', '{symbols: Array, boundingBox: Object, confidence: Number, ...}'], arguments)
    const currentWordVertices = currentWord.boundingBox.vertices.length ? currentWord.boundingBox.vertices : currentWord.boundingBox.normalizedVertices 
    const nextWordVertices = nextWord.boundingBox.vertices.length ? nextWord.boundingBox.vertices : nextWord.boundingBox.normalizedVertices 
    const currentWordEnd = currentWordVertices[1].x 
    const nextWordStart = nextWordVertices[0].x
    const spaceBeforeNextWord = nextWordStart - currentWordEnd 
    const currentWordHeight = currentWordVertices[3].y - currentWordVertices[0].y
    if (spaceBeforeNextWord < currentWordHeight) {
      return false
    }
    return true
  } 


  /**
   * Parses word list for indeces of anchor phrase
   * @param {string} anchorPhrase - Anchor phrase
   * @returns {AnchorPhraseIndeces} - Anchor phrase indeces
   */
  findAnchorPhrase(anchorPhrase) {
    validateArgs(['String'], arguments)
    let wordListIndeces = {}
    let anchorPhraseIndex = 0
    for (let i = 0; i < this.wordList.words.length; i++) {
      let page = this.wordList.words[i]
      for (let j = 0; j < page.length; j++) {
        let word = page[j]
        for (let k = 0; k < word.symbols.length; k++) {
          let symbol = word.symbols[k]
          if (symbol.text === anchorPhrase[anchorPhraseIndex]) {
            
            if (anchorPhraseIndex === 0) {
              wordListIndeces = { ...wordListIndeces, pageIndex: i, startWordIndex: j, startSymbolIndex: k }
            }
            
            if (anchorPhraseIndex === anchorPhrase.length - 1) {
              wordListIndeces = { ...wordListIndeces, endWordIndex: j, endSymbolIndex: k }
              return wordListIndeces
            }

            if (symbol.property && symbol.property.detectedBreak) {
              if (symbol.property.detectedBreak.type === 'SPACE') {
                let nextWord = page[j + 1]
                if (nextWord && this.isPhraseBreak(word, nextWord)) {
                  anchorPhraseIndex = 0
                  wordListIndeces = {}
                  continue
                } else {
                  anchorPhraseIndex += 2
                  continue
                }
              } else {
                anchorPhraseIndex = 0
                wordListIndeces = {}
                continue
              }
            }
           
            anchorPhraseIndex ++

          } else {
            anchorPhraseIndex = 0
            wordListIndeces = {}
          }
        }
      }
    }
  }
 

  /**
   * Gets coordinates of anchor phrase
   * @param {AnchorPhraseIndeces} anchorPhraseIndeces - AnchorPhrase indeces
   * @returns {Object} - Anchor phrase coords
   */
  getAnchorPhraseCoords(anchorPhraseIndeces) {
    validateArgs(['{pageIndex: Number, startWordIndex: Number, ...}'], arguments)
    const { pageIndex, startWordIndex, startSymbolIndex, endWordIndex, endSymbolIndex } = anchorPhraseIndeces
    const page = this.wordList['words'][pageIndex]
    const startSymbolBoundingBox = page[startWordIndex]['symbols'][startSymbolIndex]['boundingBox']
    const vertexType = startSymbolBoundingBox.vertices.length ? 'vertices' : 'normalizedVertices'
    const leftXCoord = startSymbolBoundingBox[vertexType][0]['x']
    const rightXCoord = page[endWordIndex]['symbols'][endSymbolIndex]['boundingBox'][vertexType][1]['x']
    let upperYCoord = 10000
    let lowerYCoord = 0
    for (let i = startWordIndex; i <= endWordIndex; i++) {
      let word = page[i]
      for (let j = (i === startWordIndex ? startSymbolIndex : 0); j <= (i === endWordIndex ? endSymbolIndex : word.symbols.length - 1); j++) {
        let symbol = word.symbols[j]
        let upperLeftYCoord = symbol['boundingBox'][vertexType][0]['y']
        let lowerRightYCoord = symbol['boundingBox'][vertexType][2]['y']
        if (upperLeftYCoord < upperYCoord) {
          upperYCoord = upperLeftYCoord
        }
        if (lowerRightYCoord > lowerYCoord) {
          lowerYCoord = lowerRightYCoord
        }
      }
    }
    return { leftXCoord, rightXCoord, upperYCoord, lowerYCoord }
  }


  /**
   * Determines if string shares more than half of its y-coordinates with another string. If so, they are considered to be on the same line 
   * @param {number} firstStringVerticalMidPoint - First string's vertical midpoint
   * @param {number} nextStringLowerRightY - Next strings's lower right y-coordinate
   * @param {number} nextStringUpperLeftY - Next string's upper left y-coordinate
   * @returns {boolean} - Whether strings are on same line
   */
  stringsAreOnSameLine(firstStringVerticalMidPoint, nextStringLowerRightY, nextStringUpperLeftY) {
    validateArgs(['Number', 'Number', 'Number'], arguments)
    if (nextStringLowerRightY > firstStringVerticalMidPoint && nextStringUpperLeftY < firstStringVerticalMidPoint) {
      return true 
    } else {
      return false
    }
  }
 
 
  /**
   * Formats cell section value as a date 
   * @param {string} cellSectValue - CSV cell section value
   * @param {Object} recurringDocCellSect - Recurring doc cell section 
   * @returns {string} - Cell section value formatted as date
   */
  getFormattedDate(cellSectValue, recurringDocCellSect) {
    validateArgs(['String', '{searchOrInputMethod: Maybe String, ...}'], arguments)
    const dateFormat = recurringDocCellSect.dateFormat || 'YYYY/MM/DD'
    const daysAdded = recurringDocCellSect.daysAdded || 0
    const formattedDate = moment(cellSectValue).add(daysAdded, 'days').format(dateFormat)
    if (formattedDate === 'Invalid date') {
      return ''
    }
    return formattedDate
  }
  
  
  /**
   * Finds cell section value using regular expression. 
   * @param {Object} recurringDocCellSect - Recurring doc cell section 
   * @returns {string} - CSV cell section value
   */
  getCellSectValueFromPattern(recurringDocCellSect) {
    validateArgs(['{searchOrInputMethod: Maybe String, ...}'], arguments)
    let cellSectValue = ''
    let regEx = new RegExp(recurringDocCellSect.phraseOrValue)
    for (let i = 0; i < this.docText.extraction.length; i++) {
      let page = this.docText.extraction[i]
      if (page.fullTextAnnotation) {
        let match = regEx.exec(page.fullTextAnnotation.text)
        if (match) {
          cellSectValue = match[0]
          return cellSectValue
        }    
      }
    }
    return cellSectValue
  }
  
  
  /**
   * Gets CSV cell section value using anchor phrases
   * @param {Object} recurringDocCellSect - Recurring doc cell section 
   * @returns {string} - CSV cell section value
   */
  getCellSectValueFromPosition(recurringDocCellSect) {
    validateArgs(['{searchOrInputMethod: Maybe String, ...}'], arguments)
    let cellSectValue = ''
    let anchorPhraseIndeces = this.findAnchorPhrase(recurringDocCellSect.phraseOrValue) // { pageIndex, startWordIndex, startSymbolIndex, endWordIndex, endSymbolIndex }
    //returns empty cellSectValue if anchor phrase isn't found
    if (!anchorPhraseIndeces) {
      return cellSectValue
    }
    let anchorPhraseCoords = this.getAnchorPhraseCoords(anchorPhraseIndeces) // { leftXCoord, rightXCoord, upperYCoord, lowerYCoord }
    let cellSectValueStartWordIndex
    let cellSectValueStartSymbolIndex
    let page = this.wordList['words'][anchorPhraseIndeces.pageIndex]
    //if anchor phrase terminates partway through a word, the cellSectValue parsing will begin with the next symbol of that word
    if (page[anchorPhraseIndeces.endWordIndex]['symbols'][anchorPhraseIndeces.endSymbolIndex + 1]) {
      cellSectValueStartWordIndex = anchorPhraseIndeces.endWordIndex
      cellSectValueStartSymbolIndex = anchorPhraseIndeces.endSymbolIndex + 1
    //if anchor phrase terminates at the end of a word, the cellSectValue parsing will begin with the next word
    } else if (page[anchorPhraseIndeces.endWordIndex + 1]) {
      cellSectValueStartWordIndex = anchorPhraseIndeces.endWordIndex + 1
      cellSectValueStartSymbolIndex = 0
    //if anchor phrase terminates at the end of the page, there will be no cellSectValue parsing and an empty string will be returned
    } else {
      return cellSectValue
    } 
    //parsing for cellSectValue
    let stringCount = 0
    let overlapStartWordIndex = null
    let lineVerticalMidPoint = (anchorPhraseCoords.lowerYCoord - anchorPhraseCoords.upperYCoord)/2 + anchorPhraseCoords.upperYCoord  
    for (let i = cellSectValueStartWordIndex; i < page.length; i++) {
      let word = page[i]
      for (let j = (i === cellSectValueStartWordIndex ? cellSectValueStartSymbolIndex : 0); j < word.symbols.length; j++) {
        let symbol = word['symbols'][j]
        let vertexType = symbol.boundingBox.vertices.length ? 'vertices' : 'normalizedVertices'
        if (recurringDocCellSect.searchOrInputMethod === 'leftPhrase') {
          cellSectValue += symbol.text 
          if (symbol.property && symbol.property.detectedBreak) {
            let nextWord = page[i + 1]
            if (symbol.property.detectedBreak.type === 'SPACE' && nextWord && !this.isPhraseBreak(word, nextWord) && recurringDocCellSect.stringType === 'phrase') {
              cellSectValue += ' '
              continue
            } else {
              stringCount ++
              if (stringCount === recurringDocCellSect.phraseCount) {
                return cellSectValue
              } else {
                cellSectValue = ''
              }  
            }
          }
        } else if (recurringDocCellSect.searchOrInputMethod === 'topPhrase') {
          let wordVertices = word['boundingBox'][vertexType]
          let stringsAreOnSameLine = this.stringsAreOnSameLine(lineVerticalMidPoint, wordVertices[2]['y'], wordVertices[0]['y']) 
          if (!stringsAreOnSameLine && wordVertices[2]['x'] > anchorPhraseCoords.leftXCoord && wordVertices[0]['x'] < anchorPhraseCoords.rightXCoord) {
            overlapStartWordIndex = i
            lineVerticalMidPoint = (wordVertices[2]['y'] - wordVertices[0]['y'])/2 + wordVertices[0]['y']
          }
          if (overlapStartWordIndex) {
            cellSectValue += symbol.text
            if (symbol.property && symbol.property.detectedBreak) {
              let nextWord = page[i + 1]
              if (symbol.property.detectedBreak.type === 'SPACE' && nextWord && !this.isPhraseBreak(word, nextWord) && recurringDocCellSect.stringType === 'phrase') {
                cellSectValue += ' '
              } else {
                stringCount ++
                if (stringCount === recurringDocCellSect.phraseCount) {
                  //prepends any adjacent special chars (if "words" string type) or words (if "phrase" string type) to the start of the target word/phrase, if they are are on the same line
                  for (let n = overlapStartWordIndex; n > 0; n--) {
                    let currentWord = page[n]
                    let prevWord = page[n - 1]
                    let prevWordText = prevWord.symbols.map(symbol => symbol.text).join('')
                    let prevWordVertices = prevWord['boundingBox'][vertexType]
                    let prevSymbol = prevWord['symbols'][prevWord.symbols.length - 1]
                    let prevWordIsOnSameLine = this.stringsAreOnSameLine(lineVerticalMidPoint, prevWordVertices[2]['y'], prevWordVertices[0]['y'])
                    let isPhraseBreak = this.isPhraseBreak(prevWord, currentWord)
                    let isSpaceAfterPrevWord = !isPhraseBreak && prevSymbol.property && prevSymbol.property.detectedBreak && prevSymbol.property.detectedBreak.type === 'SPACE'
                    if (!isPhraseBreak && prevWordIsOnSameLine ) {
                      if (!isSpaceAfterPrevWord) {
                        cellSectValue = prevWordText + cellSectValue
                      } else if (recurringDocCellSect.stringType === 'phrase') {
                        cellSectValue = prevWordText + ' ' + cellSectValue
                      } else {
                        return cellSectValue
                      }
                    } else {
                      return cellSectValue
                    }
                  }
                } else {
                  cellSectValue = ''
                  overlapStartWordIndex = null
                }
              }
            }
          }
        }
      }
    }        
    return cellSectValue
  }
     
 
  /**
   * Gets CSV cell section value using SearchOrInput method; if applicable, will also format as date and append characters 
   * @param {Object} recurringDocCellSect - Recurring doc cell section 
   * @returns {string} - CSV cell section value
   */
  getCellSectValue(recurringDocCellSect) {
    validateArgs(['{searchOrInputMethod: Maybe String, ...}'], arguments)
    let cellSectValue = ''
    if (recurringDocCellSect.searchOrInputMethod === 'pattern') {
      cellSectValue = this.getCellSectValueFromPattern(recurringDocCellSect)
    } else if (recurringDocCellSect.searchOrInputMethod === 'topPhrase' || recurringDocCellSect.searchOrInputMethod === 'leftPhrase') {
      cellSectValue = this.getCellSectValueFromPosition(recurringDocCellSect)
    } else if (recurringDocCellSect.searchOrInputMethod === 'customValue') {
      cellSectValue = recurringDocCellSect.phraseOrValue
    } else if (recurringDocCellSect.searchOrInputMethod === 'today') {
      cellSectValue = this.dateToday
    } 
    if (recurringDocCellSect.dateFormat || recurringDocCellSect.daysAdded) {
      cellSectValue = this.getFormattedDate(cellSectValue, recurringDocCellSect)
    }
    if (recurringDocCellSect.appendChars) {
      cellSectValue += recurringDocCellSect.appendChars 
    }
    cellSectValue = cellSectValue.trimStart()
    return cellSectValue
  }
  
  
  /**
   * Combines the individual CSV cell section values into one CSV cell value 
   * @param {Object} recurringDocCell - Recurring doc cell  
   * @returns {string} - CSV cell value
   */
  getCellValue(recurringDocCell) {
    validateArgs(['{cellSects: Array, ...}'], arguments)
    const self = this
    let cellValue = ''
    recurringDocCell.cellSects.forEach(recurringDocCellSect => {
      const cellSectValue = self.getCellSectValue(recurringDocCellSect)
      cellValue += cellSectValue  
    })
    return cellValue
  }
   
    
  /**
   * Compile CSV header data
   * @returns {Header} - CSV header 
   */
  getCSVHeader() {
    const CSVHeader = []
    this.recurringDoc.header.forEach((recurringDocHeaderCell, headerCellIndex) => {
      CSVHeader.push({ id: headerCellIndex.toString(), title: recurringDocHeaderCell.value })
    })
    return CSVHeader
  }
    
  
  /**
   * Compile CSV row data
   * @param {Header} CSVHeader - CSV header
   * @returns {Array<Object>} - CSV row data
   */
  getCSVDataRows(CSVHeader) {
    validateArgs(['[{ id: String, title: String }]'], arguments) 
    const self = this
    const CSVDataRows = []
    this.recurringDoc.dataRows.forEach(recurringDocRow => {
      const dataRow = {}
      recurringDocRow.dataCells.forEach((recurringDocCell, recurringDocCellIndex) => {
        const cellValue = self.getCellValue(recurringDocCell)
        dataRow[CSVHeader[recurringDocCellIndex]['id']] = cellValue
      })
      CSVDataRows.push(dataRow)
    })
    return CSVDataRows
  }
  
  
  /**
   * Compile all CSV data for a doc 
   * @returns {CSVBlueprint} - CSV blueprint
   */
  getCSVBlueprint() { 
    const CSVBlueprint = { fileName: this.docText.fileName }
    const CSVHeader = this.getCSVHeader()
    const CSVDataRows = this.getCSVDataRows(CSVHeader)
    CSVBlueprint.CSVHeader = CSVHeader
    CSVBlueprint.CSVDataRows = CSVDataRows
    return CSVBlueprint
  }
}
  
  
module.exports = CellValueGenerator