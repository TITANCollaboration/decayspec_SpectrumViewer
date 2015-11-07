xtag.register('x-rate-control', {
    lifecycle:{
        inserted: function(){
            //inject template
            promisePartial('rateControl').then(
                function(template){
                    this.innerHTML = Mustache.to_html(template, {
                        'id': this.id,
                        'gammas': dataStore.defaults.gammas,
                        'levels': dataStore.defaults.levels
                    });
                }.bind(this)
            )

            //shorthand for viewer id
            this.vw = dataStore.plots[0];
        }
    },

    methods:{
        configure: function(){
            var i, gammaWindowToggles, gammaWindowEdges, snapGammaButtons, levelToggles, fitOptions, fitRanges

            //plug in gamma window toggles
            gammaWindowToggles = document.getElementsByClassName('gammaToggle')
            for(i=0; i<gammaWindowToggles.length; i++){
                gammaWindowToggles[i].onclick = this.toggleGammaWindow.bind(this, i);
            }
            //plug in gamma window edge moving
            gammaWindowEdges = document.getElementsByClassName('gammaEdge')
            for(i=0; i<gammaWindowEdges.length; i++){
                gammaWindowEdges[i].onchange = this.moveGammaWindow.bind(this, gammaWindowEdges[i]);
            }
            //plug in snap to window buttons
            snapGammaButtons = document.getElementsByClassName('snapGateToWindow')
            for(i=0; i<snapGammaButtons.length; i++){
                snapGammaButtons[i].onclick = this.snapGateToWindow;
            }
            //plug in misc level toggles
            levelToggles = document.getElementsByClassName('levelToggles')
            for(i=0; i<levelToggles.length; i++){
                levelToggles[i].onchange = this.toggleDygraph.bind(levelToggles[i], i + dataStore.defaults.gammas.length);
            }
            //plug in background mode options
            fitOptions = document.getElementsByClassName('fitOptions')
            for(i=0; i<fitOptions.length; i++){
                fitOptions[i].onchange = this.changeFitMethod.bind(this, fitOptions[i]);
            }
            //plug in fit range inputs
            fitRanges = document.getElementsByClassName('manualBKG')
            for(i=0; i<fitRanges.length; i++){
                fitRanges[i].onchange = this.updateManualFitRange.bind(this, fitRanges[i]);
            }

        },

        drawWindow: function(index, min, max){
            //draw the appropriate window on the plot
            //<index>: number; window index, corresponds to dataStore.defaults.gammas[index]
            //<min>: number; min bin for window
            //<max>: number; max bin for window
            //this: x-rate-control object

            //delete the old lines
            dataStore.viewers[this.vw].removeVertical('min' + index);
            dataStore.viewers[this.vw].removeVertical('max' + index);
            //make new lines
            dataStore.viewers[this.vw].addVertical('min' + index, min, dataStore.defaults.gammas[index].color)
            dataStore.viewers[this.vw].addVertical('max' + index, max, dataStore.defaults.gammas[index].color)
            //make sure these lines aren't getting suppressed
            dataStore.viewers[this.vw].unsuppressAnnotation('min' + index);
            dataStore.viewers[this.vw].unsuppressAnnotation('max' + index);
        },

        toggleGammaWindow: function(index){
            //toggle the indexed gamma window on or off in the spectrum
            //<index>: number; window index, corresponds to dataStore.defaults.gammas[index]
            //this: x-rate-control object

            var payload;

            //present, remove
            if(dataStore.viewers[this.vw].verticals['min'+index] && dataStore.viewers[this.vw].suppressedAnnotations.indexOf('min'+index) == -1  ){
                dataStore.viewers[this.vw].suppressAnnotation('min'+index);
                dataStore.viewers[this.vw].suppressAnnotation('max'+index);
                payload = {"index": index, "isVisible": false };
            //not present, add
            } else{
                this.drawWindow(index, document.getElementById('min'+index).value, document.getElementById('max'+index).value );
                payload = {"index": index, "isVisible": true };
            }

            dispatcher(payload, dataStore.dygraphListeners, 'setDyVisible');
            dataStore.viewers[this.vw].plotData();
        },

        moveGammaWindow: function(element){
            //callback for chaging gamma window edges
            //<element>: input number element
            //this: x-rate-control object

            var color = dataStore.viewers[dataStore.plots[0]].verticals[element.id].color
            dataStore.viewers[dataStore.plots[0]].removeVertical(element.id)
            dataStore.viewers[dataStore.plots[0]].addVertical(element.id, parseInt(element.value, 10), color)
            this.queueAnnotation(dataStore.defaults.gammas[parseInt(element.id.slice(3),10)].title, 'Gate ' + element.id.substring(0,3) + ' updated to ' + element.value)

            dataStore.viewers[dataStore.plots[0]].plotData();
        },

        snapGateToWindow: function(){
            //callback for button to snap corresponding gamma gate to present window
            //this: button element

            var index = this.id.slice(4)

            document.getElementById('min'+index).value = dataStore.viewers[dataStore.plots[0]].XaxisLimitMin;
            document.getElementById('max'+index).value = dataStore.viewers[dataStore.plots[0]].XaxisLimitMax;

            document.getElementById('min'+index).onchange()
            document.getElementById('max'+index).onchange()
        },

        toggleDygraph: function(index){
            //set the visibility state for the indexed series in the dygraph pointed at in dataStore.dygraphListen
            //state based on the checked state of the element using this as an onchange callback.
            //<index>: number; index of dygraph series to toggle visibility of
            //this: checkbox element

            dispatcher({"index": index, "isVisible": this.checked}, dataStore.dygraphListeners, 'setDyVisible');
        },

        changeFitMethod: function(element){
            //callback after changing the fit method radio
            //<element>: object; input radio element
            //this: x-rate-control object

            var index = parseInt(element.name.slice(3),10);
            this.queueAnnotation(dataStore.defaults.gammas[index].title, 'BKG Method Changed to ' + element.value)
            fetchCallback()
        },

        updateManualFitRange: function(element){
            //callback to register a manual fit range
            //<element>: object; input text element
            //this: x-rate-control object

            var index = parseInt(element.id.slice(4),10);
            var bkgTechnique = document.querySelector('input[name="bkg'+index+'"]:checked').value;

            if(element.checkValidity()){
                dataStore.manualBKG[element.id] = element.value
                if(bkgTechnique == 'manual')
                    this.queueAnnotation(dataStore.defaults.gammas[index].title, 'Manual BKG bins updated to ' + element.value)
            }
        },

        appendNewPoint: function(){
            //integrate gamma windows and append result as new point on rate monitor.
            //this: x-rate-control object

            var i, j, id, min, max, gates = [], levels = [], bkgTechnique, bkgSample, bkgPattern, bkg, y0, y1, bkgColor;

            dataStore.viewers[dataStore.plots[0]].binHighlights = [];
            //subtract backgrounds from gates in new histogram if asked.
            for(i=0; i<dataStore.defaults.gammas.length; i++){
                id = dataStore.defaults.gammas[i].index;
                min = dataStore.viewers[dataStore.plots[0]].verticals['min' + id].bin
                max = dataStore.viewers[dataStore.plots[0]].verticals['max' + id].bin

                //attempt to fit & subtract background
                bkgTechnique = document.querySelector('input[name="bkg'+id+'"]:checked').value;
                dataStore.viewers[dataStore.plots[0]].removeLine('bkg'+id);
                if(min!=max && bkgTechnique != 'off'){
                    bkgPattern = dataStore.manualBKG['bins'+id];
                    bkgSample = [[],[]];
                    
                    //decide what range to fit bkg over
                    if(bkgTechnique=='auto'){
                        bkgSample = this.constructAutoBackgroundRange(min, max);
                    } else if(bkgTechnique=='manual' && bkgPattern ){ //ie only even try to do this if a valid bkgPattern has made it into the dataStore.

                        bkgSample = this.constructManualBackgroundRange(bkgPattern, dataStore.currentSpectrum);
                    }

                    //highlight selected background bins
                    bkgColor = fadeHexColor(dataStore.colors[i], 0.2);
                    for(j=0; j<bkgSample[0].length; j++){
                        dataStore.viewers[dataStore.plots[0]].binHighlights[bkgSample[0][j]] = {
                            'color': bkgColor,
                            'height': bkgSample[1][j]
                        }
                    }

                    //fit background
                    bkg = dataStore.viewers[dataStore.plots[0]].linearBKG.apply(null, bkgSample);

                    //update annotation with fit line
                    y0 = bkg[0] + (min-1)*bkg[1];
                    y1 = bkg[0] + max*bkg[1];
                    dataStore.viewers[dataStore.plots[0]].addLine('bkg'+id, min-1, y0, max, y1, dataStore.colors[i]);

                    //subtract the fit background
                    if(!isNaN(bkg[0]) && !isNaN(bkg[1]) ){
                        for(j=min; j<max; j++){
                            dataStore.currentSpectrum[j] -= bkg[0] + j*bkg[1];
                        }
                    }
                }
            }

            //can't continue until two histograms have been collected;
            if(dataStore.oldSpectrum.length == 0)
                return;

            //calculate change from last collection to this one
            dataStore.histoDiff = subtractHistograms(dataStore.oldSpectrum, dataStore.currentSpectrum);

            //integrate gamma window on difference histogram
            for(i=0; i<dataStore.defaults.gammas.length; i++){
                id = dataStore.defaults.gammas[i].index;
                min = dataStore.viewers[dataStore.plots[0]].verticals['min' + id].bin
                max = dataStore.viewers[dataStore.plots[0]].verticals['max' + id].bin

                gates[i] = 0;
                for(j=min; j<max; j++){
                    gates[i] += dataStore.histoDiff[j];
                }
                gates[i] /= (dataStore.currentTime - dataStore.oldTime);        
            }
            
            //add on levels data
            for(i=0; i<dataStore.defaults.levels.length; i++){
                levels.push( dataStore.scalars[dataStore.defaults.levels[i].lvlID] );
            }

            //update data history
            dataStore.rateData.push( [new Date()].concat(gates).concat(levels) );
        },

        constructAutoBackgroundRange: function(min, max){
            //returns [[bin numbers], [corresponding bin values]] based on the gate described by min, max,
            //for use as a background sample to fit to.
            //<min>: number; gate min bin
            //<max>: number; gate max bin

            var halfwidth, lowerBKG, upperBKG, bkg, bins, i;

            halfwidth = 3*(max-min);
            lowerBKG = dataStore.viewers[dataStore.plots[0]].plotBuffer[dataStore.targetSpectrum].slice(min - halfwidth, min);
            upperBKG = dataStore.viewers[dataStore.plots[0]].plotBuffer[dataStore.targetSpectrum].slice(max, max + halfwidth );
            bkg = lowerBKG.concat(upperBKG);
            bins = []
            for(i=0; i<halfwidth; i++){
                bins[i] = i + min - halfwidth;
                bins[i+halfwidth] = i + max;
            }
            return dataStore.viewers[dataStore.plots[0]].scrubPeaks(bins, bkg);

        },

        constructManualBackgroundRange: function(encoding, spectrum){
            //given an encoded string of bins, parse and return an array consising of an array of those bin numbers, and
            //another array of the corresponding bin heights.
            //encoding is as 20-25;27;32-50 etc.
            //<encoding>: string; describes bin ranges
            //<spectrum>: array; bin heights indexed by bin number.

            var rangeStrings = encoding.split(';'),
                i, j, ranges = [],
                x = [], y = [];

            if(encoding == "")
                return [x, y]

            for(i=0; i<rangeStrings.length; i++){
                ranges.push( rangeStrings[i].split('-').map(function(val){return parseInt(val, 10)}) );
            }

            for(i=0; i<ranges.length; i++){
                if(ranges[i].length == 1){
                    x.push(ranges[i][0]);
                    y.push(spectrum[ranges[i][0]]);
                } else{
                    for(j=ranges[i][0]; j<=ranges[i][1]; j++){
                        x.push(j);
                        y.push(spectrum[j]);
                    }
                }
            }

            return [x,y]
        },

        updateDygraph: function(leadingEdge, windowWidth){
            //decide how many points to keep from the history, and plot.
            //<leadingEdge>: number; as returned by x-rate-slidere windowLeadingEdgeTime
            //<windowWidth>: number; in minutes

            var i, period, data, annotations, keys

            //extract the appropriate tail of the data history
            period = windowWidth * 60 // in seconds
            period = Math.ceil(period/3); //this many points to keep at the end, 3 seconds per point
            data = dataStore.rateData.slice(Math.max(0,dataStore.rateData.length - period - leadingEdge), Math.max(0,dataStore.rateData.length - leadingEdge));

            //update the dygraph
            dispatcher({ 'data': data }, dataStore.dygraphListeners, 'updateDyData')
        },

        queueAnnotation: function(series, flag){
            //sets up the <flag> text to appear in the annotation for the next point on <series>
            //<series>: string; name of data series to annotate, corresponds to dataStore.defaults.gammas.title
            //<flag>: string; message to print in annotation

            console.log(series)
            if(dataStore.annotations[series] && dataStore.annotations[series].text.indexOf(flag) == -1){
                dataStore.annotations[series].text += '\n' + flag;
            } else{
                dataStore.annotations[series] = {
                    'series': series,
                    'shortText': '?',
                    'text': flag,
                    'cssClass': 'annotation'
                }
            }
        }

    }

});